const puppeteer = require('puppeteer')
const converter = require('json-2-csv')
const fs = require('fs')
const winston = require('winston')

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'data.log' }),
  ]
})

const links = 'https://www.saksfifthavenue.com/product/view?pid='
const linkW = 'https://www.saksfifthavenue.com/c/women-s-apparel'
const linkM = 'https://www.saksfifthavenue.com/c/men/apparel';

(async () => {
  const res = []
  async function parse (link) {
    try {
      const browser = await puppeteer.launch({ headless: false })
      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36')
      await page.addScriptTag({ url: 'https://code.jquery.com/jquery-3.2.1.min.js' })

      await page.setRequestInterception(true)
      page.on('request', request => {
        if (request.resourceType() === 'image') {
          request.abort()
        } else {
          request.continue()
        }
      })

      await page.goto(link)

      await page.waitForXPath('//*[@id="bfx-wm-close-button"]')
      await page.click('#bfx-wm-close-button')
      await page.click('#consent-close')

      let counter = 0

      // autoScroll page to the bottom to get all divs

      async function autoScroll (page) {
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let totalHeight = 0
            const distance = 100
            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight
              window.scrollBy(0, distance)
              totalHeight += distance

              if (totalHeight >= scrollHeight) {
                clearInterval(timer)
                resolve()
              }
            }, 80)
          })
        })
      }

      // function to parse longDescription

      function parseLongDesc (text) {
        const cutText = [] // new array without first sentence of description
        let joinedText
        const newText = []
        let counter = 0

        for (let i = 0; i < text.length; i++) {
          if (text[i] === '<') {
            counter = i
          }
          if (counter > 0) {
            cutText[i] = text[i]
          }
        }

        joinedText = cutText.join('')

        const noSlashText = joinedText.replace(/[/]/g, '')
        const noLiText = noSlashText.replace(/<li>/g, ' ')
        const noUlText = noLiText.replace(/<ul>/g, '')

        for (let i = 0; i < noUlText.length; i++) {
          if (noUlText[i] !== '<') {
            newText[i] = noUlText[i]
          } else {
            i = noUlText.length
          }
        }

        const newLine = newText.join('')

        return newLine.replace(/  +/g, ', ')
      }

      logger.info('Page: ' + (counter + 1))
      logger.info('Scrolling page')

      //await autoScroll(page)
      async function autoScrollTo (page) {
        await page.evaluate(async () => {
          window.scrollTo({
            top: 9000,
            behavior: "instant"
          })
        })
      }

      await autoScrollTo(page)
      await page.waitForSelector('p.page-item.d-flex.next')

      // function to get a number of the last page

      const lastPage = await page.evaluate(async () => {
        let lastPageNumber = 0

        try {
          lastPageNumber = document.querySelector('div.col-12.grid-footer > nav > div > ul > li:nth-child(6) > a').innerText
        } catch (e) {
          console.log(e)
        }
        return lastPageNumber
      })

      // parsing data for every page

      while (counter !== 2) {
        // function to get pid for every item

        const pids = await page.evaluate(async () => {
          const page_1 = []

          try {
            const divs = document.querySelectorAll('div.col-6.col-sm-4.col-xl-3.wishlist-prod-tile')
            divs.forEach(div => {
              const obj = {
                pid: div.querySelector('a.product-brand.adobelaunch__brand').dataset.adobelaunchproductid
              }
              page_1.push(obj)
            })
          } catch (e) {
            //logger.error(e)
            console.log(e)
          }
          return page_1
        })

        logger.info(pids.length)
        // get request for every item

        for (let i = 0; i < pids.length; i++) {
          const k = pids[i].pid
          const linkProd = `${links}${k}`

          const doc = await page.evaluate((linkProd) => {
            const data = $.get({
              url: linkProd,
              contentType: 'application/json',
              success: function (succeed, SuccessTextStatus, jqXHR) {
                console.log({ succeed, SuccessTextStatus, jqXHR })
              },
              error: function (jqXHR, status) {
                console.log({ jqXHR, status })
              }
            })
            return data
          }, linkProd)

          const obj = {
            uuid: doc.product.uuid !== null
              ? doc.product.uuid
              : 'No uuid',
            productName: doc.product.productName !== null
              ? doc.product.productName
              : 'No name',
            price: doc.product.price.sales !== undefined
              ? doc.product.price.sales.value
              : doc.product.price.max.sales.value,
            brand: doc.product.brand.name !== null
              ? doc.product.brand.name
              : 'No brand',
            material: parseLongDesc(doc.product.longDescription),
            topCategory: doc.product.attributes[4].attributes[0] !== undefined
              ? doc.product.attributes[4].attributes[0].value[0]
              : 'No TopCategory',
            subCategory: doc.product.attributes[4].attributes[8] !== undefined
              ? doc.product.attributes[4].attributes[8].value[0]
              : 'No SubCategory'
          }

          await res.push(obj)
        }

        await res.flat()

        await page.click('p.page-item.d-flex.next')
        await page.waitForSelector('#maincontent > div.container.search-results.hide-designer-on-cat > div > div > div.row.search-result-wrapper.tile-descriptions > div.product-tile-section.col-sm-12.col-md-9 > div.row.product-grid > div:nth-child(27)')
        //await page.waitForTimeout(4000)
        counter++
        logger.info('Page: ' + (counter + 1))
        logger.info('Scrolling page')
        await autoScrollTo(page)
        await page.waitForSelector('p.page-item.d-flex.next')
      }

      await browser.close()

      converter.json2csv(res, (err, csv) => {
        if (err) {
          throw err
        }

        const dateFilename = 'clothes_' + new Date().toJSON().slice(0, 10) + '_' + new Date().toJSON().slice(11, 19) + '.csv'
        const filename = dateFilename.replace(/[:]/g, '-')

        fs.writeFileSync(filename, csv)

        logger.info('Data saved')
      })
    } catch (e) {
      console.log(e)
    }
  }
  await parse(linkW)
 // await parse(linkM)
})()