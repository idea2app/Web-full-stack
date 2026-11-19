import { after, before, describe, it } from 'node:test';
import { expect } from 'expect';
import { chromium, type Browser, type Page } from 'playwright';

let browser: Browser;
let page: Page;

describe('Home page', () => {
    before(async () => {
        browser = await chromium.launch();
        page = await browser.newPage();
        await page.goto('http://localhost:3000?language=en-US', {
            timeout: 60000,
        });
    });

    after(async () => browser.close());

    it('should render Page head & foot', async () => {
        const title = 'Home Page - Next-Bootstrap-ts';

        expect(await page.title()).toBe(title);

        const brand = (await page.$('.navbar-brand'))?.textContent();

        expect(await brand).toBe('Next-Bootstrap-ts');

        const footer = (await page.$('#__next > footer'))?.textContent();

        expect(await footer).toMatch(/^Powered by/);
    });

    it('should render Nav links', async () => {
        const navLinks = (await page.$$('.navbar-nav .nav-link')).map(link =>
            link.textContent(),
        );
        expect(await Promise.all(navLinks)).toEqual([
            'Article',
            'Component',
            'Pagination',
            'Scroll List',
            'Source Code',
        ]);
    });

    it('should render Nav Card list', async () => {
        const links = await page.$$('main > .row:first-of-type .card');

        expect(links).toHaveLength(4);

        const path = (await links[0].$('.card-title a'))?.getAttribute('href');

        expect(await path).toBe('https://nextjs.org/docs');
    });

    it('should render Upstream Project list', async () => {
        const projects = await page.$$('main > .row:last-child .card');

        expect(projects).toHaveLength(3);

        const path = (await projects[0].$('h3 a'))?.getAttribute('href');

        expect(await path).toBe('https://github.com/vercel/next.js');
    });
});

export {};
