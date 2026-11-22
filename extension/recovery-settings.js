let recoveryLoaded=false;
async function loadRecoverySettings(){
 if(recoveryLoaded || !consoleState?.recoverySettings)return;
 for(const key of ['videoLoadSeconds','videoStallSeconds','retryLimit'])$(key).value=consoleState.recoverySettings[key];
 $('skipVideo').checked=consoleState.recoverySettings.skipVideo;recoveryLoaded=true;
}
setInterval(loadRecoverySettings,1000);void loadRecoverySettings();
$('saveRecoverySettings').addEventListener('click',async()=>{
 $('saveRecoverySettings').disabled=true;
 try{
  const values={skipVideo:$('skipVideo').checked};
  for(const key of ['videoLoadSeconds','videoStallSeconds','retryLimit'])values[key]=Number($(key).value);
  await control('/recovery-settings',values);await refreshConsole();
  $('recoverySettingsMessage').textContent='已保存并应用';
 }catch(error){$('recoverySettingsMessage').textContent=error.message;}
 finally{$('saveRecoverySettings').disabled=false;}
});
