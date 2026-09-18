import {Component,type ReactNode} from 'react';
export class PageBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<section role="alert" className="border rounded p-6 space-y-3"><h2 className="text-xl font-semibold">This page could not load</h2><p>Refresh to load the latest application files. Any unsaved changes on this page may need to be entered again.</p><button className="underline text-primary" onClick={()=>window.location.reload()}>Refresh application</button></section>:this.props.children;}
}
