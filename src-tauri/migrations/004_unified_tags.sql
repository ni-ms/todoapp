ALTER TABLE tags ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE tags ADD COLUMN code TEXT NOT NULL DEFAULT '';
ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'label';
INSERT INTO tags(id,name,color,icon,created_at,updated_at,deleted_at,description,code,kind)
 SELECT 'course-'||id,name,color,CASE kind WHEN 'course' THEN 'book' WHEN 'project' THEN 'code' ELSE 'briefcase' END,created_at,updated_at,deleted_at,description,code,kind FROM courses;
UPDATE calendar_events SET tag_ids=json_insert(tag_ids,'$[#]','course-'||(SELECT course_id FROM tasks WHERE tasks.id=calendar_events.task_id)) WHERE task_id IN (SELECT id FROM tasks WHERE course_id IS NOT NULL);
UPDATE tasks SET tag_ids=json_insert(tag_ids,'$[#]','course-'||course_id),course_id=NULL WHERE course_id IS NOT NULL;
DELETE FROM courses;
PRAGMA user_version=4;
