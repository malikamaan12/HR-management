import type {LocationFix} from '@shared/attendance-location';

export function readAttendancePosition():Promise<LocationFix>{
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation){reject(new Error('This device cannot provide location. Use a supported browser or request a reviewed attendance correction.'));return;}
  navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:new Date(p.timestamp).toISOString()}),e=>reject(new Error(e.code===1?'Location permission was denied. Enable location for this site, or request a reviewed attendance correction.':'Unable to get your location. Move to a clear area and try again.')),{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 });
}
