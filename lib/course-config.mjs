export function validateCourses(config) {
  const numeric=value=>typeof value==='string' && /^\d{1,30}$/.test(value);
  if(config?.schemaVersion!==1 || !numeric(config.cpi) || !Array.isArray(config.courses)
    || config.courses.length<1 || config.courses.length>100)throw new Error('课程配置无效：需要身份编号及 1–100 门课程');
  const seen=new Set();
  for(const course of config.courses) {
    for(const key of ['courseId','clazzId','firstChapterId','finalChapterId'])
      if(!numeric(course[key]))throw new Error(`课程字段 ${key} 必须是数字编号`);
    if(!Number.isSafeInteger(course.expectedTasks) || course.expectedTasks<1 || course.expectedTasks>100000)
      throw new Error('请填写课程目录核实的任务点总数');
    const key=`${course.courseId}:${course.clazzId}`;
    if(seen.has(key))throw new Error('课程队列包含重复课程');
    seen.add(key);
    if(typeof course.name!=='string' || course.name.length>200)throw new Error('课程名称无效');
  }
  return config;
}
