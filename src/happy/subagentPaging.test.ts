import { expect, it } from 'vitest';
import { contextUsage, markSubagents, visibleMessages } from './normalize';
import { agentSubagentWork } from './subagentEnvelopes.fixture';
import { attentionMessage, restoreClassifiedAttention } from './sessionAttention';
const rows=()=>agentSubagentWork.map((raw,index)=>({id:raw.content.id,raw,seq:index+1,createdAt:raw.content.time}));
it('should nest a later page with the bounds from an earlier scan',()=>{
  const all=rows(),child=all.find(row=>row.raw.content.ev.text?.startsWith('Subagent found'))!;
  const messages=visibleMessages([child],false,markSubagents(new Map(),all));
  expect(messages.map(message=>message.content)).toEqual(['']);
  expect(messages[0].toolCalls![0].children![0].content).toContain('Child option');
});
it('should preserve the main answer when the stop record is missing but the Agent call ended',()=>{
  const messages=visibleMessages(rows().filter(row=>row.raw.content.ev.t!=='stop'));
  expect(messages.some(message=>message.content.startsWith('The config is config.json.'))).toBe(true);
  expect(messages.flatMap(message=>message.toolCalls||[]).flatMap(call=>call.children||[]).some(message=>message.content.startsWith('Subagent found'))).toBe(true);
});
it('should keep text readable without actionable options when no bounds survive',()=>{
  const child=rows().find(row=>row.raw.content.ev.text?.startsWith('Subagent found'))!;
  expect(visibleMessages([child])[0]).toMatchObject({unplaced:true,content:expect.stringContaining('Subagent found')});
  expect(attentionMessage(child)).toBeNull();
});

it('should exclude child context usage with bounds from another page',()=>{
  // Arrange
  const all=rows(),child=all.find(row=>row.raw.content.ev.text?.startsWith('Subagent found'))!;
  const usage={...child,raw:{...child.raw,content:{...child.raw.content,usage:{input_tokens:50000,output_tokens:10,context_window:200000}}}};
  // Act
  const value=contextUsage([usage],markSubagents(new Map(),all),0);
  // Assert
  expect(value).toBeUndefined();
});

it('should use the explicit legacy parent tool id when the child prompt is absent',()=>{
  // Arrange
  const data=(value:object)=>({role:'agent',content:{type:'output',data:value}});
  const source=[{id:'parent',seq:1,createdAt:1,raw:data({type:'assistant',message:{content:[
    {type:'tool_use',id:'task',name:'Agent',input:{prompt:'Find a file'}}]}})},
    {id:'child',seq:2,createdAt:2,raw:data({type:'assistant',isSidechain:true,parent_tool_use_id:'task',uuid:'child-id',
      message:{content:[{type:'text',text:'The file is config.json.'}]}})}];
  // Act
  const messages=visibleMessages(source);
  // Assert
  expect(messages).toHaveLength(1);
  expect(messages[0].toolCalls?.[0].children?.[0].content).toBe('The file is config.json.');
});

it('should rebuild old derived attention without clearing the user read cursor',()=>{
  // Arrange
  const saved={readSeq:20,userSeq:21,assistantSeq:22,optionsSeq:22,inspectedSeq:22};
  // Act / Assert
  expect(restoreClassifiedAttention(JSON.stringify(saved),0)).toEqual({readSeq:20,userSeq:0,assistantSeq:0,optionsSeq:0,inspectedSeq:-1});
  expect(restoreClassifiedAttention(JSON.stringify({...saved,classificationVersion:2}),0)).toEqual(saved);
});
