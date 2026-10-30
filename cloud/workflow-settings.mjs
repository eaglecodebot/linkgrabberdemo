export const WORKFLOW_URL_FIELDS=['startUrl','step2StartUrl','step2SecondUrl'];
function cleanUrl(value,field){
  if(typeof value!=='string')throw new Error(field+' must be a full HTTP or HTTPS URL.');
  value=value.trim();
  if(value){
    let url;try{url=new URL(value);}catch{throw new Error('Enter a valid '+field+' URL.');}
    if(value.length>4000||!/^https?:\/\//i.test(value)||!['https:','http:'].includes(url.protocol)||url.username||url.password||value.includes('*')||/[\u0000-\u0020\u007f]/.test(value))throw new Error(field+' must be a complete HTTP or HTTPS URL without credentials, spaces or wildcards.');
  }
  return value;
}
export function cleanWorkflowSettings(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Workflow settings must be an object.');
  const result={};
  for(const field of WORKFLOW_URL_FIELDS){
    result[field]=cleanUrl(input[field]??'',field);
  }
  const alternates=input.trialAlternateUrls??[];
  if(!Array.isArray(alternates)||alternates.length>50)throw new Error('Use a list of up to 50 Trial alternate URLs.');
  result.trialAlternateUrls=[...new Set(alternates.map((value,index)=>cleanUrl(value,'Trial alternate '+(index+1))).filter(value=>value&&value!==result.startUrl))];
  return result;
}
export async function workflowSettings(repo){return cleanWorkflowSettings((await repo.globalWorkflowSettings())?.value||{});}
