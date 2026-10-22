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
