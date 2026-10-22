import type { Message } from '../data/types';
import { completedPermissions } from './toolDecisions';
import { record, type Json, type MessageRecord } from './normalize';

// Codex can reject a command before it emits a tool-call record. Keep the decision readable without claiming execution.
export function withRequestHistory(messages: Message[], state: Json, rows: Iterable<MessageRecord>): Message[] {
  const calls = new Set<string>();
  const visit = (messages: Message[]) => { for(const message of messages) for(const call of message.toolCalls || []) { calls.add(call.id); visit(call.children || []); } };
  visit(messages);
  const permissions = completedPermissions(state);
  const dates = new Map([...rows].map(row => [row.id,row.createdAt]));
  const result = [...messages];
  for(const [id,raw] of Object.entries(record(state.completedRequests))) {
    const request=record(raw), callId=typeof request.toolUseId==='string'?request.toolUseId:id;
    const permission=permissions.get(callId);
    if(!permission||permission.status==='approved'||calls.has(callId)||typeof request.tool!=='string')continue;
    const message:Message={id:`request:${callId}`,role:'assistant',content:'',tools:[request.tool],toolCalls:[{
      id:callId,name:request.tool,input:request.arguments,permission,ended:true,isError:true,
      result:permission.status==='denied'?'The request was denied before execution.':'The request was canceled before execution.',
    }]};
    const at=typeof request.createdAt==='number'?result.findIndex(message=>(dates.get(message.id)??Infinity)>=request.createdAt):-1;
    result.splice(at<0?result.length:at,0,message);calls.add(callId);
  }
  return result.length===messages.length?messages:result;
}
