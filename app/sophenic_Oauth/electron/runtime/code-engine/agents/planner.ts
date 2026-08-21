export type PlanState = 'pending'|'running'|'done'|'error';
export interface PlanStep { id:string; label:string; state:PlanState; }

export function createSophenicPlan(task:string): {title:string; steps:PlanStep[]} {
  return { title: task.slice(0,80), steps:[
    {id:'analysis',label:'Analyse besoin',state:'pending'},
    {id:'architecture',label:'Architecture',state:'pending'},
    {id:'files',label:'Création fichiers',state:'pending'},
    {id:'dependencies',label:'Installation dépendances',state:'pending'},
    {id:'tests',label:'Tests',state:'pending'},
    {id:'repair',label:'Correction bugs',state:'pending'},
    {id:'delivery',label:'Livraison',state:'pending'}
  ]};
}
