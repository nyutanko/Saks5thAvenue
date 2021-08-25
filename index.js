const puppeteer = require('puppeteer')
const converter = require('json-2-csv')
const fs = require('fs')
const winston = require('winston')

const logger = winston.createLogger({
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'data.log' })
    ]
})

const links = 'https://www.saksfifthavenue.com/product/view?pid='
const linkW = 'https://www.saksfifthavenue.com/c/women-s-apparel';

(async () => {
    const res = []

    try {
        const browser = await puppeteer.launch({ headless: false })
        const page = await browser.newPage()
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36')
        await page.addScriptTag({ url: 'https://code.jquery.com/jquery-3.2.1.min.js' })

        await page.setRequestInterception(true)
        page.on('request', request => {
            if (request.resourceType() === 'image') { request.abort() } else { request.continue() }
        })

        await page.goto(linkW)

        await page.waitForXPath('//*[@id="bfx-wm-close-button"]')
        await page.click('#bfx-wm-close-button')
        await page.click('#consent-close')

        let counter = 0

        //autoScroll page to the bottom to get all divs

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


        //function to parse longDescription

        function parseLongDesc (text) {
            const t = []  //new array without first sentence of description
            let str
            const newText = []
            let counter = 0

            for (let i = 0; i < text.length; i++) {
                if (text[i] === '<') {
                    counter = i
                }
                if (counter > 0) {
                    t[i] = text[i]
                }
            }

            str = t.join('')

            const one = str.replace(/[/]/g, '')
            const two = one.replace(/<li>/g, ' ')
            const three = two.replace(/<ul>/g, '')

            for (let i = 0; i < three.length; i++) {
                if (three[i] !== '<') {
                    newText[i] = three[i]
                } else {
                    i = three.length
                }
            }

            const newLine = newText.join('')

            return newLine.replace(/  +/g, ', ')
        }


        await autoScroll(page)


        //function to get a number of the last page

        const lastPage = await page.evaluate(async () => {
            let numPages = 0

            try {
                numPages = document.querySelector('div.col-12.grid-footer > nav > div > ul > li:nth-child(6) > a').innerText

            } catch (e) {
                logger.error(e)
            }
            return numPages
        })


        //parsing data for every page

        while(counter !== lastPage) {

            //function to get pid for every item

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
                    logger.error(e)
                }
                return page_1
            })


            //get request for every item

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

            await page.waitForSelector('p.page-item.d-flex.next')
            await page.click('p.page-item.d-flex.next')
            counter++
            await page.waitForSelector('div.col-6.col-sm-4.col-xl-3.wishlist-prod-tile')
            await autoScroll(page)
        }

        converter.json2csv(res, (err, csv) => {
            if (err) {
                throw err
            }

            fs.writeFileSync('todos.csv', csv)
        })
    } catch (e) {
        logger.error(e)
    }
})()