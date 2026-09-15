import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {useToast} from '@/hooks/use-toast';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Button} from '@/components/ui/button';
import {caseCategories,categoryLabels} from '@shared/helpdesk';
type Article={id:number;title:string;body:string;category:typeof caseCategories[number];published:boolean;version:number};
export function KnowledgeBase(){
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[editing,setEditing]=useState<Article|null|undefined>();
 const query=useQuery<{items:Article[];hasMore:boolean;canEdit:boolean}>({queryKey:['/api/helpdesk/articles',{q:search,page}]});
 return <section className="rounded-lg border bg-card p-4 space-y-3"><h2 className="text-xl font-semibold">HR knowledge base</h2>
  <label className="grid gap-1 text-sm">Search HR guidance<Input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} maxLength={100}/></label>
  {query.isError?<p role="alert">Unable to load articles. <Button onClick={()=>query.refetch()}>Retry</Button></p>:query.isLoading?<p>Loading articles…</p>:<>
   {query.data?.canEdit&&<Button variant="outline" onClick={()=>setEditing(null)}>New article</Button>}
   {!query.data?.items.length&&<p>No articles match this search.</p>}
   {query.data?.items.map(article=><details key={article.id} className="rounded border p-3"><summary className="cursor-pointer font-medium">{article.title} {!article.published&&'· Draft'}</summary>
    <p className="text-xs text-muted-foreground mt-2">{categoryLabels[article.category]} · Version {article.version}</p><p className="whitespace-pre-wrap break-words mt-3 text-sm">{article.body}</p>
    {query.data.canEdit&&<><Button variant="outline" className="mt-3" onClick={()=>setEditing(article)}>Edit article</Button><ArticleHistory id={article.id}/></>}
   </details>)}
   <div className="flex gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><Button variant="outline" disabled={!query.data?.hasMore} onClick={()=>setPage(page+1)}>Next</Button></div>
  </>}
  {editing!==undefined&&<Editor key={`${editing?.id??'new'}-${editing?.version??0}`} article={editing} onClose={()=>setEditing(undefined)}/>}
 </section>;
}
function ArticleHistory({id}:{id:number}){
 const [open,setOpen]=useState(false);const history=useQuery<Array<{id:number;version:number;snapshot:{title:string;body:string;reason:string};createdAt:string}>>({queryKey:['/api/helpdesk/articles',id,'history'],enabled:open});
 return <details className="mt-3" onToggle={e=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm">Revision history</summary>
  {history.isError?<p role="alert">Unable to load history.</p>:history.data?.map(row=><details key={row.id} className="p-2"><summary>Version {row.version} · {row.snapshot.reason}</summary><p className="whitespace-pre-wrap text-sm">{row.snapshot.title}{'\n'}{row.snapshot.body}</p></details>)}
 </details>;
}
function Editor({article,onClose}:{article:Article|null;onClose:()=>void}){
 const [title,setTitle]=useState(article?.title||''),[body,setBody]=useState(article?.body||''),[category,setCategory]=useState(article?.category||'other'),[published,setPublished]=useState(article?.published||false),[reason,setReason]=useState('');
 const cache=useQueryClient(),{toast}=useToast();
 const save=useMutation({mutationFn:()=>apiJson('/api/helpdesk/articles'+(article?`/${article.id}`:''),{method:'POST',body:{title,body,category,published,reason,expectedVersion:article?.version||0}}),onSuccess:async()=>{await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/helpdesk/articles')});toast({title:'Article saved'});onClose();},onError:error=>toast({title:'Unable to save article',description:error.message,variant:'destructive'})});
 return <form className="rounded border p-4 space-y-3" onSubmit={e=>{e.preventDefault();save.mutate();}}><h3 className="font-medium">{article?'Edit article':'New article'}</h3>
  <fieldset disabled={save.isPending} className="space-y-3">
   <label className="grid gap-1">Title<Input value={title} onChange={e=>setTitle(e.target.value)} minLength={4} maxLength={160} required/></label>
   <label className="grid gap-1">Category<select className="rounded border bg-background p-2" value={category} onChange={e=>setCategory(e.target.value as typeof category)}>{caseCategories.map(value=><option value={value} key={value}>{categoryLabels[value]}</option>)}</select></label>
   <label className="grid gap-1">Guidance<Textarea value={body} onChange={e=>setBody(e.target.value)} minLength={10} maxLength={20000} rows={7} required/></label>
   <label className="grid gap-1">Reason for this revision<Input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500} required/></label>
   <label className="flex gap-2"><input type="checkbox" checked={published} onChange={e=>setPublished(e.target.checked)}/>Visible to all signed-in employees</label>
   <p className="text-sm text-muted-foreground">Use general HR guidance only. Keep employee-specific case details in private helpdesk requests.</p>
   <div className="flex gap-2"><Button type="submit">{save.isPending?'Saving…':'Save article'}</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
  </fieldset>
 </form>;
}
