let archiveDays=null;
$('retentionDays').addEventListener('input',()=>{archiveDays=null;$('applyArchive').disabled=true;});
$('exportDiagnostics').addEventListener('click',async()=>{
  try{
    const data=await control('/diagnostics');
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='chaoxing-diagnostics.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('maintenanceMessage').textContent='已导出诊断；不含题目、答案、课程编号、路径或密钥';
  }catch(error){$('maintenanceMessage').textContent=error.message;}
});
$('previewArchive').addEventListener('click',async()=>{
  try{
    const days=Number($('retentionDays').value);const plan=await control('/maintenance/preview',{days});
    archiveDays=days;$('applyArchive').disabled=!plan.files.length;
    $('maintenanceMessage').textContent=`可归档 ${plan.files.length} 个文件或预览目录；确认后移入本机 archive，可恢复`;
  }catch(error){$('maintenanceMessage').textContent=error.message;}
});
$('applyArchive').addEventListener('click',async()=>{
  if(archiveDays===null)return;
  try{const result=await control('/maintenance/archive',{days:archiveDays});
    $('maintenanceMessage').textContent=`已归档 ${result.count} 项；恢复位置：archive/${result.archive || ''}`;
    archiveDays=null;$('applyArchive').disabled=true;
  }catch(error){$('maintenanceMessage').textContent=error.message;}
});
