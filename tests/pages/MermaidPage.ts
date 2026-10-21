import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PerformancePage } from './PerformancePage';

export class MermaidPage extends PerformancePage {
  previews() { return this.page.getByRole('figure', { name: 'Mermaid preview', exact: true }); }
  preview(index = 0) { return this.previews().nth(index); }
  diagram(index = 0) { return this.preview(index).getByRole('region', { name: 'Mermaid diagram', exact: true }); }
  image(index = 0) { return this.preview(index).getByRole('img', { name: 'Mermaid diagram', exact: true }); }
  async expectRendered(index = 0) {
    await this.diagram(index).scrollIntoViewIfNeeded();
    await expect(this.image(index)).toBeVisible({ timeout: 15000 });
    await expect.poll(() => this.image(index).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
  async expectSource(text: string, index = 0) {
    const source = this.preview(index).locator('details');
    if (!await source.evaluate((element: HTMLDetailsElement) => element.open)) await source.locator('summary').click();
    await expect(source.locator('code')).toHaveText(text);
  }
  async svg(index = 0) {
    return this.image(index).evaluate(async (image: HTMLImageElement) => (await fetch(image.src)).text());
  }
  async watchDiagram() {
    await this.image().evaluate((image) => {
      const state = { image, mutations: 0 };
      new MutationObserver((records) => { state.mutations += records.length; }).observe(image, { attributes: true });
      (window as any).__diagram = state;
    });
  }
  async expectDiagramUnchanged() {
    const state = await this.image().evaluate((image) => ({
      same: (window as any).__diagram.image === image,
      mutations: (window as any).__diagram.mutations,
    }));
    expect(state).toEqual({ same: true, mutations: 0 });
  }
  expandButton(index = 0) { return this.preview(index).getByRole('button', { name: 'Open diagram full screen', exact: true }); }
  viewer() { return this.page.getByRole('dialog', { name: 'Mermaid diagram', exact: true }); }
  async layout(index = 0) {
    return this.diagram(index).evaluate((element) => {
      const image = element.querySelector('img')!;
      return { scrolls: element.scrollWidth > element.clientWidth + 1, shown: image.getBoundingClientRect().width / image.naturalWidth };
    });
  }
  async viewerImageWidth() {
    return this.viewer().getByRole('img', { name: 'Mermaid diagram', exact: true }).evaluate((image) => image.getBoundingClientRect().width);
  }
  async expectTouchTarget(locator: ReturnType<Page['getByRole']>) {
    const box = (await locator.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
  }
  async expectPhoneDiagramUsable() {
    await this.diagram().scrollIntoViewIfNeeded();
    const scroll = this.diagram();
    const dimensions = await scroll.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
    await scroll.focus();
    await scroll.press('ArrowRight');
    await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const copy = this.preview().getByRole('button', { name: 'Copy diagram source', exact: true });
    await copy.scrollIntoViewIfNeeded();
    const target = (await copy.boundingBox())!;
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
    await this.expectNoPageOverflow();
  }
}
