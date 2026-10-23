import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ParityPage } from './pages/ParityPage';
import { agentSubagentWork } from '../src/happy/subagentEnvelopes.fixture';

const sizes=[[320,740],[360,800],[390,844],[430,932],[390,360],[844,390]];
for(const [width,height] of sizes) test(`usage, computer settings, and inline questions should remain usable at ${width}x${height}`,async({page},info)=>{
  const server=new HappyServer();await server.install(page);
  await server.setMessages([{role:'user',content:{type:'text',text:'Inspect the workspace'}},
    {role:'session',content:{role:'agent',turn:'t1',usage:{input_tokens:20000,output_tokens:50,context_window:200000},ev:{t:'text',text:'From the real protocol'}}},
    {role:'session',content:{role:'agent',turn:'t1',ev:{t:'tool-call-start',call:'question-call',name:'request_user_input',args:{}}}}]);
  await server.updateAgentState({communications:{form1:{kind:'form',toolUseId:'question-call',form:{questions:[
    {id:'choice',header:'Scope',question:'Which scope?',options:[{label:'Focused fix'},{label:'Larger change'}],allowCustom:true},
  ]}}}});
  await page.setViewportSize({width,height});test.setTimeout(90000);
  const view=new ParityPage(page),touch=!!info.project.use.hasTouch;
  await view.open('/settings/usage');
  await expect(view.report()).toContainText('2,000');await expect(view.report()).toContainText('$0.2000');
  await view.expectUsable(view.select('Usage period'));await view.expectUsable(view.select('Usage session'));
  await view.select('Usage period').selectOption('30days');await view.select('Usage session').selectOption('real-session');
  await expect.poll(()=>server.usageQueries.at(-1)?.sessionId).toBe('real-session');
  expect(server.usageQueries.at(-1)?.groupBy).toBe('day');
  await view.use(view.button('Cost',view.report()),touch);await expect(view.button('Cost',view.report())).toHaveAttribute('aria-pressed','true');
  await view.expectNoPageOverflow();
  if(width===320)await view.capture(`${info.project.name}-usage-report-320`);
  await view.open('/machine/computer');await view.use(view.button('Rename computer'),touch);
  await view.expectUsable(view.input('Computer name'));await view.input('Computer name').fill('Renamed Mac');
  await view.expectUsable(view.button('Save',view.dialog('Rename computer')));await view.use(view.button('Save',view.dialog('Rename computer')),touch);
  await expect.poll(()=>server.machineMetadata.displayName).toBe('Renamed Mac');await expect(view.dialog('Rename computer')).toHaveCount(0);
  await view.use(view.button('Remove computer'),touch);await view.use(view.button('Cancel',view.dialog('Remove computer?')),touch);
  expect(server.machineRemoved).toBe(false);
  await view.open('/settings/advanced');
  await view.expectUsable(view.select('Interface language'));await view.expectUsable(view.input('Custom Codex model ID'));
  await view.input('Custom Codex model ID').fill('gpt-custom-exact');await view.use(view.button('Save model'),touch);
  await view.expectUsable(page.getByRole('switch',{name:'Always show context usage',exact:true}));
  await view.use(page.getByRole('switch',{name:'Always show context usage',exact:true}),touch);
  await view.select('Interface language').selectOption('zh-TW');await view.expectLanguage('zh-TW');
  await expect(view.region('進階設定')).toContainText('自訂 Codex 模型 ID');
  await page.reload();await view.expectLanguage('zh-TW');await expect(view.input('自訂 Codex 模型 ID')).toHaveValue('gpt-custom-exact');
  await view.select('介面語言').selectOption('en');
  await view.open('/new');await view.use(view.button('Codex'),touch);await view.use(view.button('Choose model'),touch);
  await expect(view.dialog('Choose model')).toContainText('gpt-custom-exact');
  await view.use(view.dialog('Choose model').getByRole('radio',{name:'gpt-custom-exact',exact:true}),touch);
  await view.use(view.button('Done',view.dialog('Choose model')),touch);
  await view.open('/session/real-session');await view.expectConnected();await view.expectHeader();
  await expect(view.contextWarning()).toHaveAttribute('aria-valuenow','10');
  await expect(view.question()).toBeVisible();await expect(page.getByLabel('Agent requests',{exact:true})).toHaveCount(0);
  if(width===390&&height===844)await view.capture(`${info.project.name}-inline-question-390`);
  await view.expectUsable(view.question().getByRole('radio',{name:'Focused fix',exact:true}).locator('..'));
  await view.question().getByRole('radio',{name:'Focused fix',exact:true}).check();
  await view.expectUsable(view.button('Send answers',view.question()));await view.use(view.button('Send answers',view.question()),touch);
  await expect.poll(()=>server.communicationReplies).toEqual([{id:'form1',kind:'form',status:'answered',answers:{choice:{options:['Focused fix']}}}]);
  await expect(view.question()).toHaveCount(0);await view.expectNoPageOverflow();
  await view.open('/new');await view.input('Task description').fill('Use my exact custom model');
  await view.use(view.button('Start'),touch);
  await expect.poll(()=>server.spawns[0]?.modelMode).toBe('gpt-custom-exact');
  await expect.poll(()=>server.sends.length).toBe(1);
  const sent=await server.encryption.decrypt<{meta:Record<string,unknown>}>(server.sends.at(-1)!.content,server.dataKey);
  expect(sent.meta.model).toBe('gpt-custom-exact');
});

test('computer removal and daemon stop should require confirmation and retain conversations',async({page})=>{
  const server=new HappyServer();await server.install(page);const view=new ParityPage(page);
  await view.open('/machine/computer');await view.button('Stop daemon').click();
  expect(server.mutations).not.toContain('computer:stop-daemon');
  await view.button('Stop daemon',view.dialog('Stop daemon?')).click();
  await expect.poll(()=>server.mutations).toContain('computer:stop-daemon');await expect(view.dialog('Stop daemon?')).toHaveCount(0);
  await view.button('Remove computer').click();await view.button('Remove computer',view.dialog('Remove computer?')).click();
  await expect.poll(()=>server.machineRemoved).toBe(true);expect(server.sessions).toHaveLength(2);
  await expect(page).toHaveURL(/\/monitor$/);
});

test('usage errors should support retry without sample data',async({page})=>{
  const server=new HappyServer();server.reportFailure=true;await server.install(page);const view=new ParityPage(page);
  await view.open('/settings/usage');await expect(view.report().getByRole('alert')).toHaveText('Usage report unavailable');
  await expect(view.report()).not.toContainText('2,000');server.reportFailure=false;await view.button('Refresh usage history').click();
  await expect(view.report()).toContainText('2,000');
});

test('Claude questions should submit selected and custom answers inside the matching tool',async({page},info)=>{
  // Arrange
  const server=new HappyServer();await server.install(page);
  const questions=[{question:'Which fix should run?',header:'Scope',multiSelect:true,options:[{label:'Narrow fix'},{label:'Full fix'}]}];
  await server.setMessages([{role:'user',content:{type:'text',text:'Fix it'}},
    {role:'session',content:{role:'agent',turn:'question-turn',ev:{t:'tool-call-start',call:'question-tool',name:'AskUserQuestion',args:{questions}}}}]);
  await server.updateAgentState({requests:{'question-tool':{tool:'AskUserQuestion',arguments:{questions}}}});
  await page.setViewportSize({width:390,height:360});
  const view=new ParityPage(page),touch=!!info.project.use.hasTouch;
  // Act
  await view.open('/session/real-session');await expect(view.question()).toBeVisible();
  await expect(page.getByLabel('Agent requests',{exact:true})).toHaveCount(0);
  await view.use(view.question().getByRole('checkbox',{name:'Narrow fix',exact:true}).locator('..'),touch);
  await view.expectUsable(view.question().getByRole('textbox'));
  await view.question().getByRole('textbox').fill('Keep the API');
  await view.use(view.button('Send answers',view.question()),touch);
  // Assert
  await expect.poll(()=>server.permissionPayloads.length).toBe(1);
  expect(server.permissionPayloads[0]).toMatchObject({id:'question-tool',approved:true,updatedInput:{answers:{'Which fix should run?':'Narrow fix, Keep the API'}}});
  await expect(view.question()).toHaveCount(0);await view.expectNoPageOverflow();
});

test('Chinese labels should preserve tool jumps, original content, and offline layout',async({page},info)=>{
  // Arrange
  const server=new HappyServer();await server.install(page);
  await server.setMessages([{role:'user',content:{type:'text',text:'Inspect'}},
    {role:'agent',content:{type:'codex',data:{type:'tool-call',callId:'check',name:'Bash',input:{command:'printf done'}}}},
    {role:'agent',content:{type:'codex',data:{type:'tool-result',callId:'check',output:'Checked original output'}}},
    {role:'agent',content:{type:'codex',data:{type:'message',message:'From the real protocol\n\n<rayno-recap>See <point quote="Checked original output">the command output</point> first.</rayno-recap>'}}}]);
  await page.setViewportSize({width:390,height:360});
  const view=new ParityPage(page),touch=!!info.project.use.hasTouch;
  // Act
  await view.open('/settings/advanced');await view.select('Interface language').selectOption('zh-TW');
  await view.open('/session/real-session');
  // Assert
  await expect(view.region('對話')).toBeVisible();
  await expect(page.getByText('From the real protocol',{exact:true})).toBeVisible();
  // Act
  await view.use(view.button('顯示摘要細節'),touch);
  await view.use(view.button('the command output'),touch);
  // Assert
  await view.expectLocalizedToolsJump();
  await view.setNetwork(false);await expect(page.locator('[data-offline-status]').last()).toBeVisible();
  await view.expectNoPageOverflow();
  await view.capture(`${info.project.name}-chinese-chat-short`);
});

test('a child option on a later page should stay inside subagent work after a fresh reload',async({page})=>{
  const server=new HappyServer();await server.install(page);
  const start=agentSubagentWork.findIndex(raw=>raw.content.ev.t==='start'),stop=agentSubagentWork.findIndex(raw=>raw.content.ev.t==='stop');
  const template=agentSubagentWork.find(raw=>raw.content.ev.text?.startsWith('Subagent found'))!;
  const fillers=Array.from({length:105},(_,i)=>({...template,content:{...template.content,id:'child-'+i,ev:{t:'text',text:'Child note '+i}}}));
  await server.setMessages([...agentSubagentWork.slice(0,start+1),...fillers,...agentSubagentWork.slice(start+1,stop)]);
  const view=new ParityPage(page);await view.open('/session/real-session');await view.expectConnected();
  await expect(view.button('Child option')).toHaveCount(0);await page.reload();await view.expectConnected();
  await expect(view.button('Child option')).toHaveCount(0);
  // A collapsed group (phone layout) mounts its rows on the first expand.
  const toggle=page.getByRole('region',{name:'Tool activity',exact:true}).getByRole('button').first();
  if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
  await expect(page.getByRole('region',{name:'Chat session'})).toContainText('Find config');
});

test('the right rail should anchor formal replies without any recap',async({page},info)=>{
  test.skip(!!info.project.use.isMobile,'The response rail is a desktop control.');
  const server=new HappyServer();await server.install(page);
  const text=Array.from({length:30},(_,i)=>`Paragraph ${i+1} explains this response.`).join('\n\n');
  await server.setMessages([{role:'user',content:{type:'text',text:'First question'}},
    {role:'agent',content:{type:'codex',data:{type:'message',message:'First formal reply\n\n'+text}}},
    {role:'user',content:{type:'text',text:'Second question'}},
    {role:'agent',content:{type:'codex',data:{type:'message',message:'Second formal reply\n\n'+text}}}]);
  const view=new ParityPage(page);await view.open('/session/real-session');await expect(view.rail().getByRole('button')).toHaveText(['','']);
  await view.rail().getByRole('button',{name:'Jump to reply 1',exact:true}).click();
  await expect(view.article('First formal reply')).toHaveClass(/flash/);await view.expectInView(view.article('First formal reply'));
});
