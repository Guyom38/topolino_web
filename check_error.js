const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err));

    try {
        await page.goto('http://localhost:5000/');
        await new Promise(r => setTimeout(r, 2000));
    } catch(e) {
        console.error("GOTO ERROR", e);
    }
    await browser.close();
    process.exit();
})();