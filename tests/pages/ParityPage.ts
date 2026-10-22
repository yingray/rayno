import { expect, type Locator } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class ParityPage extends LiveWorkspacePage {
  async open(path = '/sessions') { await this.page.goto(path); }
  region(name:string) { return this.page.getByRole('region',{name,exact:true}); }
  button(name:string, scope:Locator=this.page.locator('body')) { return scope.getByRole('button',{name,exact:true}); }
  select(name:string) { return this.page.getByRole('combobox',{name,exact:true}); }
  input(name:string) { return this.page.getByRole('textbox',{name,exact:true}); }
  dialog(name:string) { return this.page.getByRole('dialog',{name,exact:true}); }
  question() { return this.page.getByRole('group',{name:'Tool question',exact:true}); }
  report() { return this.page.getByRole('region',{name:'Usage history',exact:true}); }
  rail() { return this.page.getByRole('navigation',{name:'Agent replies',exact:true}); }
  article(text:string) { return this.page.locator('article[data-message-id]').filter({hasText:text}); }
  checkbox(name:string) { return this.page.getByRole('checkbox',{name,exact:true}); }
  async use(control:Locator,touch:boolean) { await control.scrollIntoViewIfNeeded(); if(touch)await control.tap();else await control.click(); }
  async expectUsable(control:Locator) {
    await control.scrollIntoViewIfNeeded();
    const result=await control.evaluate(element=>{const box=element.getBoundingClientRect(),style=getComputedStyle(element);
      return {height:box.height,width:box.width,font:parseFloat(style.fontSize),inside:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight,
        hit:element.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2))};});
    expect(result.height).toBeGreaterThanOrEqual(44);expect(result.inside).toBe(true);expect(result.hit).toBe(true);
    if(await control.evaluate(element=>element.matches('input,select,textarea')))expect(result.font).toBeGreaterThanOrEqual(16);
  }
  async expectInView(control:Locator) { await expect(control).toBeInViewport(); }
  async expectHeader() {
    await expect(this.button('Toggle session info')).toHaveCount(0);
    const title=this.button('Open session info'),menu=this.button('Session actions');
    await this.expectUsable(title);await this.expectUsable(menu);
    const backgrounds=await Promise.all([title,menu].map(control=>control.evaluate(element=>({background:getComputedStyle(element).backgroundImage,border:getComputedStyle(element).borderColor}))));
    expect(backgrounds[0]).toEqual(backgrounds[1]);
  }
  async expectLanguage(language:string) { await expect(this.page.locator('html')).toHaveAttribute('lang',language); }
  async expectLocalizedToolsJump() {
    const group=this.page.locator('[data-tool-activity]');
    await expect(group.getByRole('button',{name:/工具活動/})).toHaveAttribute('aria-expanded','true');
    await expect(group.locator('li').first()).toHaveClass(/flash/);
  }
}
