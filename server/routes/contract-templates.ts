import {Router} from 'express';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {contractManager,templateSchema,templateIssues} from '@shared/contracts';
import {recordHandler as handle,recordHistory,WorkflowError} from '../services/workflowRecords';

const router=Router();
router.use((req,res,next)=>contractManager(req.user?.role||'')?next():res.status(403).json({message:'HR template access is required'}));
const id=z.coerce.number().int().positive();
function validate(input:z.infer<typeof templateSchema>){
  const issues=templateIssues(input);
  if(JSON.stringify(input.document).length>80000)issues.push('Keep the template under 80,000 characters.');
  if(issues.length)throw new WorkflowError(400,issues.join(' '));
}
router.get('/',handle(async(req,res)=>{
  const input=z.object({q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),available:z.enum(['true','false']).default('false')}).parse(req.query);
  const pattern='%'+input.q.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=(await db.execute(sql`SELECT id,name,category,description,active,version,updated_at,jsonb_array_length(document->'clauses') AS clause_count
    FROM contract_templates WHERE (${input.available!=='true'} OR active) AND (name ILIKE ${pattern} OR category ILIKE ${pattern}) ORDER BY active DESC,updated_at DESC,id DESC LIMIT 25 OFFSET ${(input.page-1)*24}`)).rows;
  res.json({items:rows.slice(0,24),hasMore:rows.length>24});
}));
router.get('/:id',handle(async(req,res)=>{
  const row=(await db.execute(sql`SELECT * FROM contract_templates WHERE id=${id.parse(req.params.id)}`)).rows[0];
  if(!row)throw new WorkflowError(404,'Template not found');res.json(row);
}));
router.post('/',handle(async(req,res)=>{
  const input=templateSchema.extend({submissionKey:z.string().uuid()}).parse(req.body);validate(input);
  res.status(201).json(await db.transaction(async tx=>{
    const old=(await tx.execute(sql`SELECT id FROM contract_templates WHERE created_by=${req.user.userId} AND submission_key=${input.submissionKey}`)).rows[0];if(old)return {id:old.id};
    const row=(await tx.execute(sql`INSERT INTO contract_templates(name,category,description,document,active,created_by,updated_by,submission_key)
      VALUES(${input.name},${input.category},${input.description},${JSON.stringify(input.document)}::jsonb,${input.active},${req.user.userId},${req.user.userId},${input.submissionKey}) RETURNING *`)).rows[0];
    await recordHistory(tx,req,'contract_template',row,'Contract template created');return {id:row.id};
  }));
}));
router.patch('/:id',handle(async(req,res)=>{
  const templateId=id.parse(req.params.id),input=templateSchema.extend({version:z.number().int().positive()}).parse(req.body);validate(input);
  res.json(await db.transaction(async tx=>{
    const row=(await tx.execute(sql`UPDATE contract_templates SET name=${input.name},category=${input.category},description=${input.description},
      document=${JSON.stringify(input.document)}::jsonb,active=${input.active},version=version+1,updated_by=${req.user.userId},updated_at=now()
      WHERE id=${templateId} AND version=${input.version} RETURNING *`)).rows[0];
    if(!row)throw new WorkflowError(409,'This template changed. Reload before saving.');
    await recordHistory(tx,req,'contract_template',row,input.active?'Template updated':'Template archived');return {id:row.id};
  }));
}));
export default router;
