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
  async openReadingDemo() {
    await this.page.goto('/session/paste-search-demo?demo=1');
    // Loading the demo can restore the conversation scroll position.
    await expect.poll(async () => {
      await this.preview().locator('summary').scrollIntoViewIfNeeded();
      return this.image().count();
    }, { timeout: 15000 }).toBe(1);
    await this.expectRendered();
  }
  async readLongDiagram() {
    await this.expectTouchTarget(this.expandButton());
    expect((await this.layout()).shown).toBeCloseTo(1, 2);
    await this.expandButton().tap();
    const viewer = this.viewer();
    const image = viewer.getByRole('img', { name: 'Mermaid diagram', exact: true });
    const natural = await this.image().evaluate((element: HTMLImageElement) => element.naturalWidth);
    await expect(viewer.getByText('150%', { exact: true })).toBeVisible();
    await expect(image).toBeVisible();
    expect(await this.viewerImageWidth()).toBe(Math.round(natural * 1.5));
    for (const name of ['Zoom in', 'Zoom out', 'Fit diagram to screen', 'Show diagram at actual size', 'Close Mermaid diagram']) {
      const button = viewer.getByRole('button', { name, exact: true });
      await this.expectTouchTarget(button);
      await expect(button).toBeInViewport();
    }
    const region = viewer.getByRole('region', { name: 'Full screen diagram', exact: true });
    await region.focus();
    await region.press('ArrowRight');
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await viewer.getByRole('button', { name: 'Fit diagram to screen', exact: true }).tap();
    expect(await this.viewerImageWidth()).toBeLessThanOrEqual(await region.evaluate((element) => element.clientWidth));
    await viewer.getByRole('button', { name: 'Show diagram at actual size', exact: true }).tap();
    expect(await this.viewerImageWidth()).toBeCloseTo(natural, 0);
    await viewer.getByRole('button', { name: 'Zoom in', exact: true }).tap();
    await expect(viewer.getByText('150%', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Close Mermaid diagram', exact: true }).tap();
    await expect(viewer).toHaveCount(0);
    await expect(this.expandButton()).toBeFocused();
    await this.expectNoPageOverflow();
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
