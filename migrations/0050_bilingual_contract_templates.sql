ALTER TABLE contract_clauses ADD COLUMN title_ar text NOT NULL DEFAULT '';
ALTER TABLE contract_clauses ADD COLUMN body_ar text NOT NULL DEFAULT '';
UPDATE contract_clauses SET title_ar='المسمى الوظيفي والمهام',body_ar='يعمل {{employee_name_ar}} بوظيفة {{position_ar}} في قسم {{department_ar}}. وترد المهام وترتيبات الإشراف المتفق عليها لهذه الوظيفة في هذا العقد.'
 WHERE updated_by IS NULL AND title='Role and duties' AND body='{{employee_name}} will work as {{position}} in {{department}}. The duties and reporting arrangements agreed for this position are set out in this contract.';
UPDATE contract_clauses SET title_ar='مكان العمل',body_ar='مكان العمل المتفق عليه للموظف هو {{location_ar}}. ويجب توضيح أي شروط إضافية تتعلق بمكان العمل أو التكليف في هذا العقد.'
 WHERE updated_by IS NULL AND title='Work location' AND body='The employee''s agreed work location is {{location}}. Any additional location or assignment conditions must be specified in this contract.';
UPDATE contract_clauses SET title_ar='إجراءات الشركة',body_ar='يُزوَّد الموظف بإجراءات الشركة وتعليمات العمل المتعلقة بوظيفته. وتوضح إدارة الموارد البشرية أي تحديثات تؤثر في الموظف.'
 WHERE updated_by IS NULL AND title='Company procedures' AND body='The employee will be provided with the company procedures and workplace instructions applicable to the role. HR will explain any updates that affect the employee.';
UPDATE contract_clauses SET title_ar='ممتلكات الشركة',body_ar='تُسجَّل ممتلكات الشركة المسلَّمة إلى الموظف، ويجب إعادتها وفق إجراءات التسليم الموثَّقة لدى الشركة.'
 WHERE updated_by IS NULL AND title='Company property' AND body='Company property issued to the employee will be recorded and must be returned through the company''s documented handover process.';
UPDATE contract_clauses SET title_ar='تعديل العقد',body_ar='يجب توثيق أي تعديل مقترح على الشروط المتفق عليها وتقديمه إلى الموظف للمراجعة. وتظل نسخة موقَّعة من هذه الصيغة متاحة في حساب الموظف.'
 WHERE updated_by IS NULL AND title='Contract changes' AND body='Any proposed change to the agreed terms must be documented and provided to the employee for review. A signed copy of this version remains available in the employee''s account.';

CREATE TABLE contract_templates (
 id serial PRIMARY KEY,name text NOT NULL,category text NOT NULL,description text NOT NULL DEFAULT '',
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by integer REFERENCES users(id),updated_by integer REFERENCES users(id),
 submission_key uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(created_by,submission_key)
);
CREATE INDEX contract_template_available ON contract_templates(active,category,id);
ALTER TABLE employee_contracts ADD COLUMN template_id integer REFERENCES contract_templates(id);
ALTER TABLE employee_contracts ADD COLUMN template_version integer;
ALTER TABLE employee_contracts ADD CONSTRAINT contract_template_source CHECK((template_id IS NULL AND template_version IS NULL) OR (template_id IS NOT NULL AND template_version IS NOT NULL AND template_version>0));
CREATE FUNCTION protect_contract_template_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'draft' AND (NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.template_version IS DISTINCT FROM OLD.template_version) THEN RAISE EXCEPTION 'Sent template reference is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contract_template_reference_immutable BEFORE UPDATE ON employee_contracts FOR EACH ROW EXECUTE FUNCTION protect_contract_template_reference();

-- Reusable starting points only: employee-specific dates, pay and hours are deliberately empty.
INSERT INTO contract_templates(name,category,description,document)
SELECT name,category,'Editable English–Arabic starting point. HR fills employee details, hours, pay and assignment terms before sending.',
 jsonb_build_object('title',title,'position','','department','','location','','schedule','','compensation','','companyNameAr','','companyAddressAr','',
 'arabic',jsonb_build_object('title',title_ar,'position','','department','','location','','schedule','','compensation',''),
 'clauses',jsonb_build_array(
  jsonb_build_object('title','Role and duties','body','{{employee_name}} will work as {{position}}. The agreed duties and reporting arrangements are set out in this contract.','titleAr','المسمى الوظيفي والمهام','bodyAr','يعمل {{employee_name_ar}} بوظيفة {{position_ar}}. وترد المهام وترتيبات الإشراف المتفق عليها في هذا العقد.'),
  jsonb_build_object('title','Work location','body','The agreed work location is {{location}}. Any additional assignment conditions are set out in this contract.','titleAr','مكان العمل','bodyAr','مكان العمل المتفق عليه هو {{location_ar}}. وترد أي شروط إضافية للتكليف في هذا العقد.'),
  jsonb_build_object('title','Company procedures','body','The employee will receive the workplace instructions applicable to the role. HR will explain updates that affect the employee.','titleAr','إجراءات الشركة','bodyAr','يتلقى الموظف تعليمات العمل المتعلقة بوظيفته. وتوضح إدارة الموارد البشرية التحديثات التي تؤثر في الموظف.'),
  jsonb_build_object('title',assignment_title,'body',assignment_body,'titleAr',assignment_title_ar,'bodyAr',assignment_body_ar)))
FROM (VALUES
 ('Head office employment','Head office','Head office employment contract','عقد عمل المكتب الرئيسي','Working arrangements','The working days, hours and rest days agreed for this appointment are specified in the working arrangements section.','ترتيبات العمل','تُحدَّد أيام العمل وساعاته وأيام الراحة المتفق عليها لهذا التعيين في قسم ترتيبات العمل.'),
 ('FEC / mall operations','FEC / mall','FEC / mall operations contract','عقد عمل عمليات مراكز الترفيه والمراكز التجارية','Site instructions','Before starting the assignment, the employee will receive the site instructions relevant to their role and the contact details of their designated supervisor.','تعليمات الموقع','قبل بدء التكليف، يتلقى الموظف تعليمات الموقع المتعلقة بدوره وبيانات التواصل مع المشرف المعيَّن له.'),
 ('Event assignment','Events','Event assignment contract','عقد تكليف بفعالية','Assignment details','The event name, venue, assignment dates, role and reporting contact must be entered in this contract before it is issued.','تفاصيل التكليف','يجب تدوين اسم الفعالية ومكانها وتواريخ التكليف والدور الوظيفي ومسؤول الإشراف في هذا العقد قبل إصداره.')
) AS presets(name,category,title,title_ar,assignment_title,assignment_body,assignment_title_ar,assignment_body_ar);
