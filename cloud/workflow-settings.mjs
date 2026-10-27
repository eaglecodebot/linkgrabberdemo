export const WORKFLOW_URL_FIELDS=['startUrl','step2StartUrl','step2SecondUrl'];
export function cleanWorkflowSettings(input){
  const result={};
  for(const field of WORKFLOW_URL_FIELDS){
    const value=String(input[field]??'').trim();
    if(value){
      let url;try{url=new URL(value);}catch{throw new Error('Enter a valid '+field+' URL.');}
      if(value.length>4000||!['https:','http:'].includes(url.protocol)||url.username||url.password||value.includes('*')||/[\u0000-\u0020\u007f]/.test(value))throw new Error(field+' must be a complete HTTP or HTTPS URL without credentials, spaces or wildcards.');
    }
    result[field]=value;
  }
  return result;
}
export async function workflowSettings(repo){return cleanWorkflowSettings((await repo.globalWorkflowSettings())?.value||{});}
