'use strict';
// Experimental online adapter. Authentication tokens remain in memory only.
const BI_URL = 'https://pxkyaczxjlddezwlttqw.supabase.co';
const BI_KEY = 'sb_publishable_t4uRtNebVcmTlFzubmgIYg_0Pk6ndiR';
let biToken = null, biBusy = false;
async function biEmail(id) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id.trim()));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 40) + '@users.brightinventory.invalid';
}
async function biRequest(path, options = {}) {
  const res = await fetch(BI_URL + path, { ...options, headers: { apikey: BI_KEY, 'Content-Type': 'application/json', ...(biToken ? { Authorization: 'Bearer ' + biToken } : {}), ...(options.headers || {}) } });
  if (!res.ok) {
    if (res.status === 401) { biToken = null; SESSION = null; showLogin(); }
    let code = ''; try { { const payload = await res.json(); code = payload.code || payload.error || ''; } } catch (_) {}
    if (code === '23505') throw new Error('একই তথ্য আগে থেকে আছে।');
    if (code === '23503' || code === 'user_in_use_or_not_found') throw new Error('ইউজার বা আইটেমটির সংশ্লিষ্ট রেকর্ড আছে, অথবা সেটি পাওয়া যায়নি।');
    if (code === 'duplicate_id' || code === 'account_creation_failed') throw new Error('ইউজার আইডি আগে থেকে থাকতে পারে। অন্য আইডি দিন।');
    throw new Error('সার্ভারে কাজটি সম্পন্ন হয়নি। অনুমতি ও ইন্টারনেট সংযোগ যাচাই করুন।');
  }
  if (res.status === 204) return null;
  const text = await res.text(); return text ? JSON.parse(text) : null;
}
async function biRows(table) {
  const all = []; let offset = 0;
  while (true) {
    const batch = await biRequest('/rest/v1/' + table + '?select=*&order=id&limit=1000&offset=' + offset);
    all.push(...batch); if (batch.length < 1000) return all; offset += batch.length;
  }
}
async function biLoad() {
  const [users, items, units, receives, issues] = await Promise.all(['bi_users','bi_items','bi_units','bi_receives','bi_issues'].map(biRows));
  DB = {
    version: 1,
    users: users.map(u => ({id:u.id, authId:u.auth_id, name:u.name, isAdmin:u.is_admin, permissions:u.permissions || {}, createdAt:u.created_at})),
    items: items.map(x => ({id:x.id, name:x.name, createdAt:x.created_at})),
    units: units.map(x => ({id:x.id, itemId:x.item_id, name:x.name, createdAt:x.created_at})),
    receives: receives.map(x => ({id:x.id, itemId:x.item_id, unitId:x.unit_id, qty:x.quantity, date:x.entry_date, description:x.description, by:x.created_by, createdAt:x.created_at})),
    issues: issues.map(x => ({id:x.id, itemId:x.item_id, unitId:x.unit_id, qty:x.quantity, date:x.entry_date, userId:x.recipient_id, by:x.created_by, status:x.status, rejectReason:x.rejection_reason, decidedAt:x.decided_at, createdAt:x.created_at}))
  };
}
async function biAction(work, message) {
  if (biBusy) return;
  biBusy = true; let committed = false;
  try {
    await work(); committed = true;
    await biLoad(); closeModal(); renderApp(); toast(message, 'success');
  } catch (err) {
    if (committed) { toast('তথ্য সেভ হয়েছে, কিন্তু হালনাগাদ তালিকা আনা যায়নি। আবার লগইন করে যাচাই করুন।', 'error'); }
    else toast(err.message || 'কাজটি করা যায়নি।', 'error');
  } finally { biBusy = false; }
}
function biPost(table, body) { return biRequest('/rest/v1/' + table, {method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify(body)}); }
function biPatch(table, id, body) { return biRequest('/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(body)}).then(rows=>{if (!rows || rows.length !== 1) throw new Error('রেকর্ড পাওয়া যায়নি বা অনুমতি নেই।');}); }
function biDelete(table, id) { return biRequest('/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {method:'DELETE',headers:{Prefer:'return=representation'}}).then(rows=>{if (!rows || rows.length !== 1) throw new Error('রেকর্ড পাওয়া যায়নি বা অনুমতি নেই।');}); }
function biRequired(value, message) { if (!value) throw new Error(message); return value; }
function biQty(id) { const q = Number(document.getElementById(id).value); if (!Number.isSafeInteger(q) || q <= 0) throw new Error('পরিমাণ ধনাত্মক পূর্ণসংখ্যা হতে হবে।'); return q; }
function biValue(id) { return document.getElementById(id).value.trim(); }

handleLogin = async function(e) {
  e.preventDefault(); if (biBusy) return; biBusy = true;
  const input = document.getElementById('loginPassword'), error = document.getElementById('loginError'), errorText = document.getElementById('loginErrorText');
  const id = biValue('loginId'), password = input.value; error.hidden = true;
  try {
    if (!id || !password) throw new Error('ইউজার আইডি ও পাসওয়ার্ড দিন।');
    const email = await biEmail(id);
    const result = await biRequest('/auth/v1/token?grant_type=password', { method:'POST',body:JSON.stringify({email,password}) });
    biToken = result.access_token;
    if (!biToken || !result.user || !result.user.id) throw new Error('লগইন সেশন পাওয়া যায়নি।');
    await biLoad();
    if (!DB.users.some(u => u.id === id && u.authId === result.user.id)) throw new Error('অ্যাকাউন্টের প্রোফাইল যুক্ত নয়।');
    SESSION = {userId:id}; renderApp();
  } catch (err) { biToken = null; SESSION = null; errorText.textContent = 'লগইন হয়নি। ইউজার আইডি, পাসওয়ার্ড ও ইন্টারনেট সংযোগ যাচাই করুন।'; error.hidden = false; }
  finally { input.value = ''; biBusy = false; }
};
logout = async function() {
  const token = biToken; biToken = null; SESSION = null;
  DB = {version:1,users:[],items:[],units:[],receives:[],issues:[]};
  showLogin();
  try { if (token) await biRequest('/auth/v1/logout',{method:'POST',headers:{Authorization:'Bearer '+token}}); } catch (_) {}
};
saveDB = function() { throw new Error('অফলাইন স্টোরেজ এই অনলাইন সংস্করণে বন্ধ।'); };
// Settings-only users do not have access to transaction rows, so do not show partial totals as zeros.
const biOldItemsPanel = itemsPanel, biOldUnitsPanel = unitsPanel;
itemsPanel = function(admin) {
  if (admin || canAccess('inventory') || canAccess('report')) return biOldItemsPanel(admin);
  return '<div class="notice notice-info">আইটেমের নাম দেখা যাবে। হিসাব দেখার জন্য ইনভেন্টরি বা রিপোর্ট অনুমতি প্রয়োজন।</div><div class="card"><div class="card-body">' + (DB.items.length ? DB.items.map(x=>'<p>'+esc(x.name)+'</p>').join('') : 'কোনো আইটেম নেই।') + '</div></div>';
};
unitsPanel = function(admin) {
  if (admin || canAccess('inventory') || canAccess('report')) return biOldUnitsPanel(admin);
  return '<div class="notice notice-info">ইউনিটের নাম দেখা যাবে। ব্যবহারের হিসাব দেখার জন্য ইনভেন্টরি বা রিপোর্ট অনুমতি প্রয়োজন।</div><div class="card"><div class="card-body">' + (DB.units.length ? DB.units.map(x=>'<p>'+esc(itemName(x.itemId))+' — '+esc(x.name)+'</p>').join('') : 'কোনো ইউনিট নেই।') + '</div></div>';
};
// Account operations are authorized by the server-side admin function.
const biOldAddUserCard = addUserCard;
addUserCard = function() { return biOldAddUserCard().replace('id="suPass" type="text"', 'id="suPass" type="password" minlength="8"').replace('যেমন: 17', 'ইংরেজি অক্ষর, সংখ্যা, _ অথবা -'); };
handleAddUser = function(e) {
  e.preventDefault(); if (!requireAdmin()) return;
  biAction(async()=>{
    const id=biValue('suId'), name=biValue('suName'), input=document.getElementById('suPass'), password=input.value;
    const permissions={}; document.querySelectorAll('#addUserForm input[name=perm]:checked').forEach(cb=>permissions[cb.value]=true);
    if(!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('ইউজার আইডিতে শুধু ইংরেজি অক্ষর, সংখ্যা, _ অথবা - ব্যবহার করুন।');
    if(!name || password.length<8 || !Object.keys(permissions).length) throw new Error('নাম, অন্তত ৮ অক্ষরের পাসওয়ার্ড ও অন্তত একটি অনুমতি দিন।');
    try { await biRequest('/functions/v1/bi-manage-users',{method:'POST',body:JSON.stringify({action:'create',id,name,password,permissions})}); }
    finally { input.value=''; }
  },'নতুন ইউজার যোগ হয়েছে।');
};
openEditUser = function(id) {
  if (!requireAdmin()) return;
  const u = userById(id); if (!u) return;
  if (u.isAdmin) { toast('অ্যাডমিনের নাম ও অনুমতি পরিবর্তন আপাতত বন্ধ।', 'error'); return; }
  openModal({title:'ইউজার এডিট করুন',subtitle:'আইডি: '+u.id,
    body:'<form id="editUserForm" onsubmit="saveEditUser(event)"><input type="hidden" id="euId" value="'+esc(u.id)+'"><div class="field"><label for="euName">নাম</label><input class="input" id="euName" value="'+esc(u.name)+'" required></div><div class="field"><span class="field-label">মেনু পারমিশন</span><div class="perm-check">'+PAGES.map(p=>'<label class="perm-opt"><input type="checkbox" name="perm" value="'+p+'"'+(u.permissions[p]?' checked':'')+'> '+PERM_LABEL[p]+'</label>').join('')+'</div></div><p class="hint">পাসওয়ার্ড ইউজার নিজে পরিবর্তন করবেন; আগের পাসওয়ার্ড দেখানো হয় না।</p></form>',
    footer:'<button type="button" class="btn btn-outline" onclick="closeModal()">বাতিল</button><button type="submit" form="editUserForm" class="btn btn-primary">সেভ করুন</button>'});
};
saveEditUser = function(e) { e.preventDefault(); if (!requireAdmin()) return; biAction(async()=>{const id=biValue('euId'),name=biValue('euName'),permissions={};document.querySelectorAll('#editUserForm input[name=perm]:checked').forEach(cb=>permissions[cb.value]=true);if(!name||!Object.keys(permissions).length)throw new Error('নাম ও অন্তত একটি অনুমতি দিন।');await biRequest('/functions/v1/bi-manage-users',{method:'POST',body:JSON.stringify({action:'edit',id,name,permissions})});},'ইউজারের তথ্য আপডেট হয়েছে।'); };
deleteUser = function(id) { if(!requireAdmin())return;const user=userById(id);if(!user||user.isAdmin)return;if(!confirm('ইউজার '+user.name+' ডিলিট করতে চান?'))return;biAction(()=>biRequest('/functions/v1/bi-manage-users',{method:'POST',body:JSON.stringify({action:'delete',id})}),'ইউজার ডিলিট হয়েছে।'); };
changePassword = async function(e) {
  e.preventDefault(); if (biBusy || !currentUser()) return;
  const current = document.getElementById('cpCurrent').value, next = document.getElementById('cpNew').value, confirmPassword = document.getElementById('cpConfirm').value;
  if (next.length < 8 || next !== confirmPassword || next === current) { toast('নতুন পাসওয়ার্ড অন্তত ৮ অক্ষরের, নিশ্চিতকরণের সাথে মিল এবং পুরনোটি থেকে আলাদা হতে হবে।', 'error'); return; }
  biBusy = true;
  try {
    const email = await biEmail(currentUser().id);
    const verified = await biRequest('/auth/v1/token?grant_type=password', {method:'POST',body:JSON.stringify({email,password:current})});
    if (!verified || !verified.access_token) throw new Error('বর্তমান পাসওয়ার্ড যাচাই হয়নি।');
    biToken = verified.access_token;
    await biRequest('/auth/v1/user',{method:'PUT',body:JSON.stringify({password:next})});
    closeModal(); toast('পাসওয়ার্ড পরিবর্তন হয়েছে।', 'success');
  } catch (_) { toast('পাসওয়ার্ড পরিবর্তন হয়নি। বর্তমান পাসওয়ার্ড ও সংযোগ যাচাই করুন।', 'error'); }
  finally { biBusy = false; }
};

handleAddItem = function(e) { e.preventDefault(); if (!requireAdmin()) return; biAction(async()=>{const name=biRequired(biValue('itName').replace(/\s+/g,' '),'আইটেমের নাম দিন।');await biPost('bi_items',{name});},'আইটেম যোগ হয়েছে।'); };
saveEditItem = function(e) {e.preventDefault();if(!requireAdmin())return;biAction(async()=>{const id=biValue('eiId'),name=biRequired(biValue('eiName').replace(/\s+/g,' '),'আইটেমের নাম দিন।');await biPatch('bi_items',id,{name});},'আইটেম আপডেট হয়েছে।');};
deleteItem = function(id) {if(!requireAdmin()||!confirm('আইটেমটি ডিলিট করতে চান?'))return;biAction(()=>biDelete('bi_items',id),'আইটেম ডিলিট হয়েছে।');};
handleAddUnit = function(e) {e.preventDefault();if(!requireAdmin())return;biAction(async()=>{const item_id=biRequired(biValue('unItem'),'আইটেম নির্বাচন করুন।'),name=biRequired(biValue('unName').replace(/\s+/g,' '),'ইউনিটের নাম দিন।');await biPost('bi_units',{item_id,name});},'ইউনিট যোগ হয়েছে।');};
saveEditUnit = function(e) {e.preventDefault();if(!requireAdmin())return;biAction(async()=>{const id=biValue('euId2'),item_id=biRequired(biValue('euItem2'),'আইটেম নির্বাচন করুন।'),name=biRequired(biValue('euName2').replace(/\s+/g,' '),'ইউনিটের নাম দিন।');await biPatch('bi_units',id,{item_id,name});},'ইউনিট আপডেট হয়েছে।');};
deleteUnit = function(id) {if(!requireAdmin()||!confirm('ইউনিটটি ডিলিট করতে চান?'))return;biAction(()=>biDelete('bi_units',id),'ইউনিট ডিলিট হয়েছে।');};
handleReceive = function(e) {e.preventDefault();if(!canAccess('inventory'))return;biAction(async()=>{const item_id=biRequired(biValue('rvItem'),'আইটেম নির্বাচন করুন।'),unit_id=biRequired(biValue('rvUnit'),'ইউনিট নির্বাচন করুন।'),quantity=biQty('rvQty'),entry_date=biRequired(biValue('rvDate'),'তারিখ নির্বাচন করুন।'),description=biValue('rvDesc');await biPost('bi_receives',{item_id,unit_id,quantity,entry_date,description,created_by:currentUser().id});},'গ্রহণ সেভ হয়েছে।');};
handleIssue = function(e) {e.preventDefault();if(!canAccess('inventory'))return;biAction(async()=>{const recipient_id=biRequired(biValue('isUser'),'ইউজার নির্বাচন করুন।'),item_id=biRequired(biValue('isItem'),'আইটেম নির্বাচন করুন।'),unit_id=biRequired(biValue('isUnit'),'ইউনিট নির্বাচন করুন।'),quantity=biQty('isQty'),entry_date=biRequired(biValue('isDate'),'তারিখ নির্বাচন করুন।');if(quantity>availableFor(item_id,recipient_id)&&!confirm('প্রদানের পরিমাণ উপলব্ধ পরিমাণের বেশি। তবুও সেভ করবেন?'))throw new Error('প্রদান বাতিল হয়েছে।');await biPost('bi_issues',{recipient_id,item_id,unit_id,quantity,entry_date,created_by:currentUser().id});},'প্রদান সেভ হয়েছে।');};
async function biDecision(id,decision,reason) { await biRequest('/rest/v1/rpc/bi_decide_issue',{method:'POST',body:JSON.stringify({issue_id:id,decision,reason})}); }
decideIssue = function(id,status) {if(status==='rejected'){askReject(id);return;}biAction(()=>biDecision(id,'accepted',null),'গ্রহণ নিশ্চিত হয়েছে।');};
confirmReject = function(e) {e.preventDefault();const id=biValue('rejectId'),reason=biValue('rejectReason');if(!reason){toast('রিজেক্টের কারণ দিন।','error');return;}biAction(()=>biDecision(id,'rejected',reason),'রিজেক্ট সেভ হয়েছে।');};
const biOriginalGo = go;
go = async function(page) {
  if (!SESSION || biBusy) return;
  biBusy = true;
  try { await biLoad(); if (!currentUser()) { await logout(); return; } biOriginalGo(page); }
  catch (_) { toast('সর্বশেষ তথ্য আনা যায়নি। ইন্টারনেট সংযোগ যাচাই করুন।', 'error'); }
  finally { biBusy = false; }
};
async function biRefresh() {
  if (!SESSION || biBusy) return;
  biBusy = true;
  try { await biLoad(); renderApp(); toast('তথ্য হালনাগাদ হয়েছে।', 'success'); }
  catch (_) { toast('তথ্য হালনাগাদ করা যায়নি।', 'error'); }
  finally { biBusy = false; }
}
// Do not display the offline demo as an online session.
showLogin();
