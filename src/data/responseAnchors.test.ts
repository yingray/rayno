import { expect, it } from 'vitest';
import { responseAnchors } from './responseAnchors';
it('should anchor formal replies without requiring a recap and exclude work rows',()=>{
  expect(responseAnchors([
    {id:'user',role:'user',content:'Question'}, {id:'answer',role:'assistant',content:'Formal answer'},
    {id:'think',role:'assistant',content:'',thinking:'Think'},
    {id:'tool',role:'assistant',content:'',toolCalls:[{id:'call',name:'Agent',children:[{id:'child',role:'assistant',content:'Child answer'}]}]},
    {id:'event',role:'assistant',content:'',event:{type:'switch',mode:'local'}},
    {id:'unknown',role:'assistant',content:'Unplaced',unplaced:true},
    {id:'recap',role:'assistant',content:'<rayno-recap>Summary</rayno-recap>'},
  ]).map(anchor=>anchor.id)).toEqual(['answer']);
});

it('should size dots by visible non-whitespace characters without Markdown syntax, recaps, or options', () => {
  const anchors = responseAnchors([
    { id: 'small', role: 'assistant', content: '**短文** [連結](https://example.com/' + 'x'.repeat(3000) + ')\n\n<rayno-recap>' + '摘要'.repeat(2000) + '</rayno-recap>\n<options><option>' + '選項'.repeat(2000) + '</option></options>' },
    { id: 'medium', role: 'assistant', content: '中'.repeat(500) },
    { id: 'large', role: 'assistant', content: '長'.repeat(2000) },
  ]);
  expect(anchors.map(({ characters, size }) => ({ characters, size }))).toEqual([
    { characters: 4, size: 'small' }, { characters: 500, size: 'medium' }, { characters: 2000, size: 'large' },
  ]);
});
