import {defaultInductionSettings,type InductionContent} from './induction';
import type {CourseDefinition} from './employee-services';

// Imported by server code only. Never return question keys to catalogue clients.
export const safetyLibraryVersion=1;
export const safetyLibraryReviewedOn='2026-09-19';
type Source={title:string;url:string};
type LessonSeed={title:string;body:string;source:Source;minutes:number};
type QuestionSeed={prompt:string;options:string[];correct:number[];explanation:string};
export type SafetyCourseSeed={key:string;title:string;description:string;audience:string;durationMinutes:number;lessons:LessonSeed[];questions:QuestionSeed[];sources:Source[]};
const source=(title:string,url:string):Source=>({title,url});
const risk=source('HSE: managing workplace risks','https://www.hse.gov.uk/simple-health-safety/risk/index.htm');
const slips=source('HSE: cleaning and slip prevention','https://www.hse.gov.uk/slips/cleaning.htm');
const fire=source('HSE: work process fire safety','https://www.hse.gov.uk/fireandexplosion/workplace.htm');
const evacuation=source('GOV.UK: workplace evacuation plans','https://www.gov.uk/workplace-fire-safety-your-responsibilities/fire-safety-and-evacuation-plans');
const emergency=source('HSE: event incidents and emergencies','https://www.hse.gov.uk/event-safety/incidents-and-emergencies.htm');
const fireRoles=source('GOV.UK: fire procedures and responsibilities','https://www.gov.uk/government/publications/people-with-duties-under-fire-safety-laws/a-guide-for-persons-with-duties-under-fire-safety-legislation-accessible');
const firstAid=source('HSE: employee first aid arrangements','https://www.hse.gov.uk/firstaid/employee.htm');
const cpr=source('St John Ambulance: adult CPR','https://www.sja.org.uk/first-aid-advice/cpr/');
const burns=source('NHS: burns and scalds','https://www.nhs.uk/conditions/burns-and-scalds/');
const qatarEmergency=source('Hamad Medical Corporation: emergency guide','https://www.hamad.qa/EN/Hospitals-and-services/alwakra/Patients-and-Visitors/Documents/PF%20Materials/AWH-Quick-Guide_Emergency.pdf');
const handling=source('HSE: manual handling at work','https://www.hse.gov.uk/msd/manual-handling/');
const technique=source('HSE: good handling technique','https://www.hse.gov.uk/msd/manual-handling/good-handling-technique.htm');
const retail=source('HSE: manual handling in retail','https://www.hse.gov.uk/retail/manual-handling.htm');
const crowd=source('HSE: monitoring the crowd','https://www.hse.gov.uk/event-safety/crowd-management-monitoring.htm');
const controls=source('HSE: crowd controls','https://www.hse.gov.uk/event-safety/crowd-management-controls.htm');
const crowdRisks=source('HSE: crowd safety risks','https://www.hse.gov.uk/event-safety/crowd-management-assess.htm');
const heat=source('HSE: heat stress at work','https://www.hse.gov.uk/temperature/employer/heat-stress.htm');
const heatIllness=source('CDC/NIOSH: heat-related illnesses','https://www.cdc.gov/niosh/heat-stress/about/illnesses.html');
const cooling=source('NHS: heat exhaustion and heatstroke','https://www.nhs.uk/conditions/heat-exhaustion-heatstroke/');
const awareness='Internal awareness training. Completion records learning and a quiz result; it does not certify practical competence or replace your site briefing, risk assessment or specialist training.';
const localBriefing='Before working independently, ask your supervisor to show you the current site instructions, emergency contacts and reporting route. Apply the venue’s approved arrangements; report a conflict or missing instruction before starting the task.';

export const safetyCourseLibrary:SafetyCourseSeed[]=[
 {key:'workplace-hse-awareness',title:'Workplace HSE awareness',audience:'All employees, temporary staff and event teams',durationMinutes:25,
  description:'Recognise workplace hazards, prevent routine incidents and report concerns across offices, mall activations and FEC sites. '+awareness,
  sources:[risk,slips,emergency],lessons:[
   {title:'Recognise hazards before starting',minutes:7,source:risk,body:`A hazard is something that can cause harm. Risk considers the chance of harm and its possible severity. A cable across an activation walkway is a hazard; visitors tripping over it is a possible outcome. Consider employees, contractors and the visiting public when checking a task.

Look for what has changed: deliveries, a new layout, unfamiliar equipment, wet floors or a queue reaching a working area. Remove the hazard where possible; otherwise follow the agreed controls. Stop your own task and notify the supervisor if an essential control is missing. A completed checklist does not make an unsafe area safe.

Scenario: the approved display layout leaves an exit clear, but a late delivery fills that route. Keep the route protected, tell the lead and arrange a safe storage location before opening the activity.

${localBriefing}`},
   {title:'Keep routes and work areas safe',minutes:7,source:slips,body:`Check walking routes at the start of work and after setup changes. Look for contamination, poor lighting, uneven surfaces, loose packaging and items that make people step into another hazard. Treat spills and cleaning as active work: protect the affected area and arrange suitable cleaning so people do not walk through it.

Use the site’s approved cable routing, storage and housekeeping arrangements. Do not move a hazard from the staff area into a public route. Keep tools and materials within the authorised setup boundary. Follow instructions for footwear and protective equipment; report damaged or unsuitable items.

Practice scenario: a drink spills beside a family queue. Alert nearby people, protect the affected route without blocking escape, and get the spill dealt with. A warning sign alone is not the completed corrective action.`},
   {title:'Report clearly and support a safe handover',minutes:6,source:emergency,body:`Know who leads an emergency response, how to raise the alarm and where to obtain first aid. During an incident, protect your own safety and communicate the location, what happened, the immediate danger and what help is needed. Follow the authorised emergency instructions and keep access available for responders.

For internal reporting, record observable facts: date, time, location, people involved, the hazard and actions already taken. Report near misses as well as injuries so the team can correct the conditions. Do not guess the cause or assign blame. Keep personal medical details within the authorised reporting channel.

At handover, identify unresolved hazards and their owner. For example: “The rear cable cover is damaged; that route is closed and the site lead is arranging replacement.” Confirm the next team understands the restriction.`},
  ],questions:[
   {prompt:'A delivery blocks an emergency route before opening. What should you do?',options:['Open as planned and move it later','Protect the route and arrange safe storage with the supervisor before opening','Place a poster in front of the delivery'],correct:[1],explanation:'A planned control must work in the actual site layout.'},
   {prompt:'Which statements about hazards and risk are correct? Select all correct answers.',options:['A hazard can cause harm','Risk considers likelihood and severity','A signed checklist removes every hazard','Visitors may also be exposed to a workplace hazard'],correct:[0,1,3],explanation:'Assess the actual hazards and everyone who may be affected.'},
   {prompt:'What completes the response to a spill on a public walkway?',options:['Only placing a warning sign','Protecting the area and arranging effective cleaning before normal use','Waiting until a visitor reports a fall'],correct:[1],explanation:'The hazard needs effective control and removal.'},
   {prompt:'Why report a near miss?',options:['To identify and correct conditions before someone is hurt','Only to assign blame','Only if equipment was destroyed'],correct:[0],explanation:'Near misses provide an opportunity to improve controls.'},
   {prompt:'Which information belongs in an incident report?',options:['Assumptions about who is guilty','Facts about time, location, hazard and actions taken','Unrelated private information about employees'],correct:[1],explanation:'Use accurate observations and the authorised reporting route.'},
   {prompt:'A required safety control is missing. What is the appropriate response?',options:['Continue because the task is familiar','Stop your own task and notify the supervisor','Ask a visitor to supervise'],correct:[1],explanation:'Resolve the missing control before continuing the affected task.'},
  ]},
 {key:'fire-safety-awareness',title:'Fire safety and evacuation awareness',audience:'All employees and venue teams',durationMinutes:25,
  description:'Prevent avoidable fire risks and understand the employee response to alarms, evacuation and assembly. '+awareness,
  sources:[fire,evacuation,fireRoles],lessons:[
   {title:'Prevent fire during normal work',minutes:6,source:fire,body:`Fire prevention includes controlling ignition sources and combustible materials. Follow the approved storage arrangements for packaging, aerosols, cleaning products and other flammable materials. Do not introduce heating, charging or demonstration equipment without the site’s authorisation.

Report damaged equipment, unusual heat, burning smells or a proposed change that could create an ignition source. Only authorised, competent people should inspect, repair or alter electrical and fire protection systems. Keep combustible waste under control and away from heat sources.

Activation scenario: additional display lights arrive after setup approval. Refer the change to the site lead before they are connected. Commercial urgency is not approval to improvise an electrical installation.

${localBriefing}`},
   {title:'Know the route before the alarm',minutes:7,source:evacuation,body:`Find the designated escape routes, an alternative if one is unsafe, the assembly point and the method used to raise the alarm. Routes and emergency doors must remain available for use. Know how the plan assists people with mobility or other support needs; use only the role and equipment you have been trained to use.

When the alarm or authorised evacuation instruction is given, stop the activity and follow the site plan promptly. Direct visitors using the agreed instructions and a safe route. Do not delay evacuation to collect stock or personal property, and do not enter a smoke-affected route to investigate.

Scenario: a display narrows the exit approach. Report and correct it before admitting visitors. Knowing an exit exists is insufficient if people cannot reach or use it.`},
   {title:'Assembly, communication and limits of your role',minutes:7,source:fireRoles,body:`At the assembly location, follow the site’s accountability process and tell the responsible person about anyone unaccounted for or a route problem. Pass accurate information to responders; do not return to search a hazardous area yourself. Re-entry and restarting activities follow the authorised response leader’s instruction.

This awareness course does not appoint you as a fire marshal or train you to fight a fire. Extinguisher use requires the site’s specific training and authorisation, suitable equipment and a safe opportunity to escape. Raising the alarm and getting people to safety take priority over protecting merchandise.

Ask your supervisor to confirm the alarm signal, assembly location and your assigned evacuation responsibility for each new event or mall site.`},
  ],questions:[
   {prompt:'Extra electrical display equipment arrives after setup approval. What should happen first?',options:['Connect it if a socket is available','Obtain the site lead’s approval and required competent checks','Let a visitor decide whether it is safe'],correct:[1],explanation:'A changed installation needs the approved site process.'},
   {prompt:'Which items should you know before starting work? Select all correct answers.',options:['Escape routes','Assembly point','How to raise the alarm','Only the stockroom location'],correct:[0,1,2],explanation:'Familiarity with emergency arrangements supports a prompt response.'},
   {prompt:'The fire alarm sounds while you are serving a visitor. What is the appropriate priority?',options:['Complete every transaction first','Follow the evacuation plan and guide the visitor towards safety','Collect display stock first'],correct:[1],explanation:'Safety takes priority over transactions and merchandise.'},
   {prompt:'Someone is unaccounted for at assembly. What should you do?',options:['Re-enter to search alone','Give the responsible person accurate information and remain available','Assume the person went home'],correct:[1],explanation:'Responders need accurate information; do not enter a hazardous area.'},
   {prompt:'Does completing this course authorise you to operate any extinguisher?',options:['Yes, all equipment','No; specific site training and authorisation are still needed'],correct:[1],explanation:'Awareness completion is not practical firefighting competence.'},
   {prompt:'Who decides when the affected activity can restart?',options:['The first employee to finish their break','The authorised response leader under the site plan','Any customer who wants to continue'],correct:[1],explanation:'Re-entry and restart must follow the authorised response.'},
  ]},
 {key:'first-aid-awareness',title:'First aid awareness for employees',audience:'All employees, event and FEC teams',durationMinutes:30,
  description:'Recognise an emergency, summon help and understand safe initial actions. This is awareness only, not a first-aider qualification or assessed practical CPR training.',
  sources:[firstAid,cpr,burns,qatarEmergency],lessons:[
   {title:'Prepare to get the right help',minutes:6,source:firstAid,body:`Know the first-aid contact for the shift, how to reach them, and where the first-aid kit and any AED are located. First-aid provision must match the workplace; a temporary site may have different arrangements from the office. Confirm arrangements before beginning your shift.

Check for danger before approaching someone who is hurt. Do not become another casualty by entering a live electrical, traffic or other unsafe area. Ask for the trained responder and follow their direction. Respect the person’s privacy and explain what you are doing when they can respond.

Passing this quiz does not make you an appointed or qualified first aider. Practical skills require suitable training and assessment. Your immediate contribution can still be vital: identify the emergency, raise help promptly, give a clear location and guide responders to the person.`},
   {title:'Recognise collapse and act without delay',minutes:8,source:cpr,body:`An adult who is unresponsive and not breathing normally needs immediate emergency help and CPR. Occasional gasps are not normal breathing. Call the local emergency service, use speakerphone where possible and follow the dispatcher’s instructions. Ask another person to bring an AED if available; do not delay the emergency call while searching for one.

For an adult, chest compressions are delivered in the centre of the chest at 100–120 per minute, allowing the chest to recoil, to a depth of about 5–6 cm. Follow the dispatcher and the AED’s prompts. If unable or unwilling to give rescue breaths, continuous chest compressions are advised. Children and infants require age-appropriate guidance; tell the dispatcher the person’s age and follow their instructions.

This lesson introduces recognition and response. It does not replace hands-on CPR/AED training. Arrange practical training for staff whose role requires it.`},
   {title:'Burns and scalds: avoid making the injury worse',minutes:6,source:burns,body:`For a thermal burn or scald, cool the affected area under cool running water for 20 minutes as soon as possible. Remove nearby jewellery or clothing only if it is not stuck to the skin. Do not put butter, oils or creams on the injury, and do not burst blisters.

Summon the trained first aider and seek urgent medical help for serious, large or deep burns and for electrical or chemical burns. Chemical exposures have different decontamination needs: alert responders, protect yourself and follow emergency guidance rather than treating them as an ordinary hot-water scald.

Scenario: a colleague spills hot liquid over their arm. Arrange safe cooling and help promptly; applying a cream to “soothe” it is not the first response. Keep the person otherwise warm and protect their privacy.`},
   {title:'Give an effective emergency call and handover',minutes:5,source:qatarEmergency,body:`In Qatar, call 999 for a life-threatening emergency. At an event, describe the mall or venue, the exact activation or FEC location, the best entrance and a contact number. Say what you can observe: whether the person responds, whether breathing appears normal and any immediate danger. Stay on the line and follow the call handler.

Ask a colleague to meet the response team at the agreed entrance when that can be done safely. Do not leave a vulnerable person without arranging appropriate support. Tell the responder what happened, when it happened and what help has already been given.

For work outside Qatar, confirm the correct local emergency number during the site briefing. The company incident record is completed after urgent care has been arranged; paperwork must not delay emergency help.`},
  ],questions:[
   {prompt:'What should you do before approaching an injured person?',options:['Check for immediate danger to yourself and others','Take a photograph first','Ask them to finish their shift'],correct:[0],explanation:'Avoid creating another casualty.'},
   {prompt:'An adult is unresponsive and only making occasional gasps. What is the best response?',options:['Wait to see whether they wake up','Call emergency help immediately, start CPR and follow dispatcher/AED guidance','Offer a drink'],correct:[1],explanation:'Occasional gasps are not normal breathing.'},
   {prompt:'What emergency number is taught here for life-threatening emergencies in Qatar?',options:['999','A number remembered from a different country','The payroll extension only'],correct:[0],explanation:'Hamad Medical Corporation directs life-threatening emergencies in Qatar to 999.'},
   {prompt:'What is the initial cooling measure for a thermal burn or scald?',options:['Cool running water for 20 minutes','Butter or cooking oil','Bursting blisters'],correct:[0],explanation:'Prompt water cooling is the initial measure; do not use creams or oils.'},
   {prompt:'Which information helps emergency responders? Select all correct answers.',options:['Exact location and access entrance','What happened and what you observe','Actions already taken','Unrelated private gossip'],correct:[0,1,2],explanation:'A clear factual handover helps responders reach and assess the person.'},
   {prompt:'What does this course completion demonstrate?',options:['An assessed practical first-aider qualification','Completion of internal awareness lessons and their quiz','Permission to provide any medical treatment'],correct:[1],explanation:'Practical competence and designated roles require separate suitable training.'},
  ]},
 {key:'manual-handling-awareness',title:'Safe manual handling awareness',audience:'Setup crews, stores, promoters and FEC teams',durationMinutes:25,
  description:'Plan safer movement of stock, barriers and event equipment, recognise handling risks and use assistance appropriately. '+awareness,
  sources:[handling,technique,retail],lessons:[
   {title:'Avoid the hazardous move where possible',minutes:6,source:handling,body:`Manual handling includes carrying, lifting, lowering, pushing and pulling. First ask whether the move can be avoided or changed: deliver closer to the use point, split a consignment or use suitable handling equipment. If a hazardous manual task cannot be avoided, assess it and reduce the risk before proceeding.

Weight alone does not decide whether a move is safe. Shape, grip, visibility, distance, frequency and the person’s capability matter. There is no single weight that makes every load safe for every employee.

Scenario: a large but relatively light display panel blocks your view and catches on doors. Treat its size and route as risks. Ask for a suitable handling plan rather than assuming that “light” means “safe”.`},
   {title:'Plan the route and use controlled movement',minutes:7,source:technique,body:`Before a permitted lift, check the destination and clear the route. Use the approved aid or help where needed. Ensure you can take a secure hold and keep the load close. Adopt a balanced stance, move smoothly and turn by moving your feet rather than twisting your body while supporting the load.

Do not jerk a load, reach beyond your control or handle more than you can safely manage. Put a load down before adjusting its final position when appropriate. Good technique supports the overall handling plan; it does not compensate for an unsuitable load or unsafe environment.

Practice scenario: the destination shelf is not ready. Prepare it before starting rather than waiting while holding the load. If the route becomes obstructed, stop in a controlled way and reassess.`},
   {title:'Match the task to people and equipment',minutes:7,source:retail,body:`The task, individual, load and environment all affect handling risk. Report pain, restricted movement or a concern that the planned activity exceeds your capability. Early reporting allows the supervisor to adjust the job or obtain appropriate advice.

Use trolleys and other aids only as instructed, within their intended purpose and capacity. Report damaged wheels, unstable loads or a route the aid cannot negotiate safely. Assistance should be planned: agree the movement, destination and communication before a team move. Do not assume two people automatically make an unsuitable load safe.

At shift handover, report recurring awkward moves, damaged aids and changes to storage. A useful improvement might be moving frequently used items to a more accessible position rather than repeating the same risky lift.`},
  ],questions:[
   {prompt:'What is the first option to consider for a hazardous manual handling task?',options:['Avoid or redesign the manual move where possible','Lift quickly before anyone notices','Assume gloves remove every risk'],correct:[0],explanation:'Avoiding the hazardous move is preferable to relying only on technique.'},
   {prompt:'Which factors can affect handling risk? Select all correct answers.',options:['Load size and grip','Route and environment','Individual capability','Only the weight shown on the box'],correct:[0,1,2],explanation:'Weight is one part of a wider handling assessment.'},
   {prompt:'How should you generally turn while supporting a manageable load?',options:['Twist the back while keeping the feet fixed','Move the feet to change direction','Lean sideways as far as possible'],correct:[1],explanation:'Moving the feet avoids twisting while handling.'},
   {prompt:'The trolley has a damaged wheel. What should happen?',options:['Use it until the shift ends','Report it and arrange a suitable safe alternative','Ask a visitor to balance it'],correct:[1],explanation:'A defective aid can introduce further risk.'},
   {prompt:'Does a low stated weight guarantee a safe lift?',options:['Yes','No; shape, route, frequency and capability also matter'],correct:[1],explanation:'No single weight makes all handling tasks safe.'},
   {prompt:'You develop pain during repeated moves. What should you do?',options:['Report it promptly so the task can be reviewed','Hide it until the project ends','Move faster to finish sooner'],correct:[0],explanation:'Early reporting supports a safer task and timely assistance.'},
  ]},
 {key:'event-fec-crowd-safety',title:'Event, mall activation and FEC crowd safety',audience:'Event staff, FEC employees and team leads',durationMinutes:25,
  description:'Keep public routes usable, recognise pressure around queues and attractions, and escalate crowd concerns using the venue plan. '+awareness,
  sources:[crowd,controls,crowdRisks],lessons:[
   {title:'Watch the places where pressure builds',minutes:7,source:crowd,body:`Crowd safety is about both total attendance and where people gather. A site can be below its overall capacity while one attraction, queue or exit is overcrowded. Observe entrances, exits, popular activities, stairs, escalators and narrow sections. Watch for distress, pushing, people falling or difficulty moving.

Report changes early using the agreed communication channel. Give a precise location and observable conditions, not just “it is busy”. For example: “The queue at game two now reaches the main entrance and visitors cannot pass.” Continue monitoring within your assigned role and request support when another duty prevents effective observation.

Your counting method and operational limits come from the site plan. Do not invent a capacity figure based on how full the area looks.`},
   {title:'Manage entry and queues using the approved plan',minutes:7,source:controls,body:`Before opening, check that designated exits, visitor routes and emergency access are usable. Use the approved queue layout, barriers, signs and staff positions. A queue needs a safe way for people to leave without forcing through those behind them or entering vehicle movement.

Keep queues away from unsafe traffic routes and stair congestion. Report when demand exceeds the planned arrangement, and apply the authorised pause or redirection procedure. Do not lock an emergency exit to make counting or ticket checks easier, and do not improvise a barrier layout that creates a bottleneck.

Scenario: a popular giveaway creates a sudden queue across mall circulation. Escalate promptly and follow the agreed control, including pausing admission if instructed, while keeping escape and access routes clear.`},
   {title:'Include vulnerable visitors and communicate changes',minutes:6,source:crowdRisks,body:`Children, people with disabilities and people unfamiliar with the venue may need additional information or help. Consider how visitors enter, move through an activity and leave. Do not assume everyone can hear an announcement, read the same language or use a route without assistance.

At an FEC or family activation, follow the venue’s agreed lost-child and reunion process; bring in the designated supervisor or security team promptly. Stay within your assigned role and protect the child’s privacy. A generic online course does not replace those local safeguards.

During setup changes, check for crossflows, attractions obstructing passage and visitors entering vehicle or construction areas. Record concerns for the event debrief so the next layout improves. Report near misses even where no injury occurred.`},
  ],questions:[
   {prompt:'The whole venue is below capacity, but people cannot move near one game. What does this mean?',options:['There cannot be a crowd risk','Local overcrowding still needs prompt attention','Only ticket sales matter'],correct:[1],explanation:'Distribution and local pressure matter alongside total numbers.'},
   {prompt:'Which locations need crowd observation? Select all correct answers.',options:['Entrances and exits','Popular attractions and queues','Narrow passages and stairs','Only the staff office'],correct:[0,1,2],explanation:'These areas can develop pressure or congestion.'},
   {prompt:'A queue extends into an emergency access route. What should you do?',options:['Ignore it until the queue is longer','Report it and apply the approved control to keep access clear','Lock the nearest exit'],correct:[1],explanation:'The approved queue and emergency arrangements must remain effective.'},
   {prompt:'What is a useful radio report?',options:['Everything is bad','Queue at game two blocks the main entrance; visitors cannot pass','A guess about how many visitors will arrive tomorrow'],correct:[1],explanation:'Give a specific location and observable problem.'},
   {prompt:'A child is separated from their guardian at the FEC. What should you use?',options:['The venue’s lost-child process and designated support','An improvised private arrangement','Publicly post the child’s personal details'],correct:[0],explanation:'Follow the approved safeguarding and reunion process.'},
   {prompt:'Who sets capacity and admission controls for your work area?',options:['The agreed venue/event plan and authorised supervisors','Any employee based only on visual estimates','Customers waiting in the queue'],correct:[0],explanation:'Use the approved operational limits and escalation route.'},
  ]},
 {key:'heat-stress-awareness',title:'Heat stress awareness for site and event teams',audience:'Outdoor crews, loading teams and hot-work areas',durationMinutes:25,
  description:'Recognise heat exposure, follow rest and hydration controls, and escalate possible heat illness promptly. '+awareness,
  sources:[heat,heatIllness,cooling,qatarEmergency],lessons:[
   {title:'Heat exposure is more than the temperature',minutes:7,source:heat,body:`Heat risk depends on workload, humidity, air movement, radiant heat and clothing as well as air temperature. Heavy unloading or restrictive clothing can increase strain. New or returning workers may need time to adapt; tell the supervisor about concerns through the appropriate health and safety channel.

Follow the site’s heat controls: planned work and rest periods, a cooler recovery area, access to drinking water and any task restrictions. Drink regularly rather than waiting for severe thirst. Use suitable mechanical aids and changes to the work to reduce physical effort where provided.

Do not remove required protective equipment to cope with heat without arranging a safe alternative. Ask the supervisor to adjust the work when the conditions or controls are unsuitable. A busy event schedule does not cancel a planned recovery break.`},
   {title:'Spot illness and escalate without waiting',minutes:7,source:heatIllness,body:`Headache, weakness, dizziness, nausea and heavy sweating can indicate heat illness. Stop the affected work, move to a cooler safe area and obtain first-aid or medical help. Have someone remain with the person.

Confusion, collapse, seizures or altered behaviour in a hot environment are emergency warning signs. Heatstroke can occur with hot dry skin or with heavy sweating; sweating does not rule it out. Call emergency medical help immediately and begin safe cooling while following the dispatcher. In Qatar, call 999 for a life-threatening emergency.

Scenario: an unloading colleague becomes confused and cannot follow a simple instruction. Do not send them to finish the job or leave them alone to “sleep it off”. Raise emergency help promptly.`},
   {title:'Support cooling and a safe return',minutes:6,source:cooling,body:`Move an affected person to a cooler place when safe, remove unnecessary outer clothing and cool the skin with water and airflow while arranging help. An alert person who can safely swallow may sip cool water. Do not give drinks to someone who is not fully alert or cannot swallow safely. Stay with them and follow medical instructions.

For severe symptoms, call immediately; do not wait for a fixed period to see whether they improve. Worsening symptoms or failure to recover also require medical advice. Report the exposure and the controls that were available so the supervisor can address the conditions.

Returning to work is not simply finishing a water bottle. Follow the medical and supervisor guidance, and ensure the task and heat controls have been reviewed before resuming.`},
  ],questions:[
   {prompt:'Which factors affect heat risk? Select all correct answers.',options:['Humidity and workload','Clothing and radiant heat','Only the number on a thermometer','Access to cooling and rest controls'],correct:[0,1,3],explanation:'Heat risk depends on the person, task and environment.'},
   {prompt:'A planned recovery break clashes with a busy delivery. What is the right response?',options:['Skip all breaks','Follow the heat controls and ask the supervisor to adjust the work','Wait until someone collapses'],correct:[1],explanation:'Work should be organised around effective heat controls.'},
   {prompt:'A hot, confused colleague is still sweating. What should you do?',options:['Rule out heatstroke because of the sweat','Treat the confusion as an emergency warning and get immediate help','Send them to work alone'],correct:[1],explanation:'Sweating does not rule out serious heat illness.'},
   {prompt:'When may an affected person safely be offered sips of water?',options:['When fully alert and able to swallow safely','While unconscious','Whenever a bottle is available, regardless of condition'],correct:[0],explanation:'Do not give oral fluids when swallowing is unsafe.'},
   {prompt:'What should happen while help is arranged?',options:['Leave the person alone','Stay with them, move to safe cooling where possible and follow instructions','Require them to complete a report before receiving care'],correct:[1],explanation:'Support and cooling must not be delayed by paperwork.'},
   {prompt:'Who should guide a return after heat illness?',options:['Medical and supervisor guidance with effective task controls','The event countdown alone','Any coworker who wants the shift to finish'],correct:[0],explanation:'Recovery and working conditions need to be considered before resuming.'},
  ]},
];

const id=(course:number,kind:number,index:number)=>`e3c00000-${String(course).padStart(4,'0')}-4000-8000-${String(kind*10000+index).padStart(12,'0')}`;
export function materializeSafetyCourse(seed:SafetyCourseSeed,approverId:number,provider:string):{definition:CourseDefinition;content:InductionContent}{
 const course=safetyCourseLibrary.findIndex(item=>item.key===seed.key)+1;
 const content:InductionContent={settings:{...defaultInductionSettings,employeeTypes:[...defaultInductionSettings.employeeTypes],departments:[],mandatoryForOnboarding:false,reviewRequired:false,enrollmentApprovalRequired:false,allowSelfEnrollment:true,passScore:80,maxAttempts:3,attemptMinutes:15,validMonths:null},
  lessons:seed.lessons.map((lesson,index)=>({id:id(course,1,index+1),title:lesson.title,kind:'text',body:lesson.body+`\n\nReference: ${lesson.source.title}\n${lesson.source.url}\n\nSource guidance checked ${safetyLibraryReviewedOn}. This is original internal awareness content informed by the reference; it is not endorsed by that organisation.`,assetId:null,required:true,estimatedMinutes:lesson.minutes})),
  questions:seed.questions.map((question,index)=>({id:id(course,2,index+1),prompt:question.prompt,kind:question.correct.length>1?'multiple':'single',options:question.options.map((text,option)=>({id:id(course,3,(index+1)*10+option+1),text})),correctOptionIds:question.correct.map(option=>id(course,3,(index+1)*10+option+1)),points:1,explanation:question.explanation})),
 };
 return {definition:{title:seed.title,description:seed.description,provider:provider.trim().length>=2?provider.trim().slice(0,150):'Internal learning team',format:'self_paced',url:'',durationMinutes:seed.durationMinutes,capacity:null,passScore:content.settings.passScore,requiresEvidence:false,validMonths:null,approverId,status:'published',delivery:'internal'},content};
}

export function safetyCourseSummaries(){return safetyCourseLibrary.map(({key,title,description,audience,durationMinutes,lessons,questions,sources})=>({key,title,description,audience,durationMinutes,lessonCount:lessons.length,questionCount:questions.length,sources,libraryVersion:safetyLibraryVersion,reviewedOn:safetyLibraryReviewedOn}));}
