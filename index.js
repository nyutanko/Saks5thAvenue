const puppeteer = require('puppeteer')
const converter = require('json-2-csv')
const fs = require('fs')
const winston = require('winston')
const moment = require('moment')

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'data.log' })
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

      logger.info('Page: ' + (counter + 1))
      logger.info('Scrolling page')

      // await autoScroll(page)
      async function autoScrollTo (page) {
        await page.evaluate(async () => {
          window.scrollTo({
            top: 9000,
            behavior: 'instant'
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
          logger.info(e)
        }
        return lastPageNumber
      })

      // parsing data for every page

      while (counter !== lastPage) {
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
            logger.info(e)
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
            allInfo: doc.product
          }

          await res.push(obj)
        }

        await res.flat()

        if (counter < lastPage - 1) {
          await page.click('p.page-item.d-flex.next')
          await page.waitForSelector('#maincontent > div.container.search-results.hide-designer-on-cat > div > div > div.row.search-result-wrapper.tile-descriptions > div.product-tile-section.col-sm-12.col-md-9 > div.row.product-grid > div:nth-child(27)')
          counter++
          logger.info('Page: ' + (counter + 1))
          logger.info('Scrolling page')
          await autoScrollTo(page)
          await page.waitForSelector('p.page-item.d-flex.next')
        } else {
          counter++
        }
      }
      await browser.close()
    } catch (e) {
      logger.info(e)
    }
  }
  await parse(linkW)
  await parse(linkM)

  const results = []
  const searchFieldType = 'label'
  const searchValType = 'Type refinement'

  function TypeRefinement (arr) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i][searchFieldType] === searchValType) {
        return arr[i].value[0]
      }
    }
  }

  const searchFieldCountry = 'label'
  const searchValCountry = 'country of origin'

  function CountryOfOrigin (arr) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i][searchFieldCountry] === searchValCountry) {
        return arr[i].value[0]
      }
    }
  }

  const searchFieldStatus = 'variantAvailabilityStatus'
  const searchValIn = 'IN_STOCK'

  function InStock (arr) {
    const inStockResults = []
    for (let i = 0; i < arr.length; i++) {
      if (arr[i][searchFieldStatus] === searchValIn) {
        inStockResults.push(arr[i].value)
      }
    }
    return inStockResults.join(', ')
  }

  const searchValOut = 'NOT_AVAILABLE'

  function OutOfStock (arr) {
    const outStockResults = []
    for (let i = 0; i < arr.length; i++) {
      if (arr[i][searchFieldStatus] === searchValOut) {
        outStockResults.push(arr[i].value)
      }
    }
    return outStockResults.join(', ')
  }

  for (let i = 0; i < res.length; i++) {
    const object = {
      pid: res[i].allInfo.id,
      item_name: res[i].allInfo.productName,
      vendor_name: res[i].allInfo.brand.name,
      product_line: TypeRefinement(res[i].allInfo.attributes[4].attributes),
      origin_country: CountryOfOrigin(res[i].allInfo.attributes[6].attributes),
      instock_num: res[i].allInfo.numberOfInStockItems,
      in_stock: InStock(res[i].allInfo.variationAttributes[1].values),
      out_of_stock: OutOfStock(res[i].allInfo.variationAttributes[1].values),
      cost_price: res[i].allInfo.price.sales !== undefined
        ? res[i].allInfo.price.sales.value
        : res[i].allInfo.price.max.sales.value + '-' + res[i].allInfo.price.min.sales.value,
      item_url: res[i].allInfo.pdpURL,
      url: res[i].allInfo.images.small[0].url
    }
    await results.push(object)
  }

  converter.json2csv(results, (err, csv) => {
    if (err) {
      throw err
    }

    const dateFilename = 'clothes_' + moment().format('DD-MM-YYYY') + '_' + moment().format('hh-mm-ss') + '.csv'
    const filename = dateFilename.replace(/[:]/g, '-')

    fs.writeFileSync(filename, csv)

    logger.info('Data saved')
  })
})()
