export function moneyCents(value:string|number):number {
  const text=String(value).trim();if(!/^\d{1,10}(\.\d{1,2})?$/.test(text))throw new Error('Enter a non-negative amount with up to two decimal places');
  const [whole,fraction='']=text.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(cents))throw new Error('Amount is too large');return cents;
}
export function moneyText(cents:number):string{if(!Number.isSafeInteger(cents))throw new Error('Invalid amount');return `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;}
export function calculatePayroll(basic:string|number,allowances:Record<string,string|number>,deductions:Record<string,string|number>){
  const basicCents=moneyCents(basic),allowanceCents=Object.values(allowances).reduce<number>((sum,value)=>sum+moneyCents(value),0),deductionCents=Object.values(deductions).reduce<number>((sum,value)=>sum+moneyCents(value),0);
  const net=basicCents+allowanceCents-deductionCents;if(net<0)throw new Error('Deductions exceed gross salary');
  return {basicSalary:moneyText(basicCents),allowances:Object.fromEntries(Object.entries(allowances).map(([key,value])=>[key,moneyText(moneyCents(value))])),
    deductions:Object.fromEntries(Object.entries(deductions).map(([key,value])=>[key,moneyText(moneyCents(value))])),netSalary:moneyText(net)};
}
export function csvCell(value:unknown):string{let text=String(value ?? '');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
