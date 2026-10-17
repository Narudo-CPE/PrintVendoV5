import asyncio
import html
import logging
import json
import secrets
import time
from typing import Any, Dict, Set, Tuple
from urllib.parse import quote

import requests
import uvicorn
from dotenv import set_key
from fastapi import FastAPI, Form, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse

from kiosk_backend.config import APP_ROOT, settings

logger = logging.getLogger("kiosk.gcash_app")
app = FastAPI(title="GCash Payment Confirmation", docs_url=None, redoc_url=None)
_operator_sessions: Dict[str, Tuple[str, float]] = {}
_pending_requests: Dict[str, Dict[str, Any]] = {}
_event_queues: Set[asyncio.Queue] = set()
_latest_system_status: Dict[str, Any] = {
    "components": {
        "acceptor": {"name": "Acceptor Arduino 1", "status": "Unknown", "connected": False, "details": "Waiting for monitor"},
        "actuator": {"name": "Actuator Arduino 2", "status": "Unknown", "connected": False, "details": "Waiting for monitor"},
        "printer": {"name": "Epson L121", "status": "Unknown", "connected": False, "details": "Waiting for CUPS query"},
    },
    "critical_alerts": [],
    "checked_at": None,
}
SESSION_TTL_SECONDS = 8 * 60 * 60


def _valid_session(request: Request):
    token = request.cookies.get("gcash_operator")
    session = _operator_sessions.get(token or "")
    if not session or session[1] <= time.time():
        _operator_sessions.pop(token or "", None)
        return None
    return token, session[0]


def _page(content: str, title: str = "GCash Confirmation", dashboard: bool = False) -> HTMLResponse:
    width = "min(1240px,calc(100% - 40px))" if dashboard else "min(420px,calc(100% - 40px))"
    return HTMLResponse(
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{html.escape(title)}</title><style>"
        ":root{color-scheme:dark;--navy:#07101f;--panel:rgba(13,25,46,.82);--panel-inner:rgba(17,31,55,.82);"
        "--line:rgba(148,184,224,.16);--blue:#3b82f6;--muted:#91a1b8;--green:#4ade80;--red:#fb555d}"
        "*{box-sizing:border-box}body{font:15px system-ui,-apple-system,'Segoe UI',sans-serif;"
        "background:radial-gradient(ellipse at 12% 0%,#11264a 0%,#081326 38%,#050b16 78%);"
        "color:#f8fafc;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}"
        f".panel{{width:{width};background:linear-gradient(145deg,rgba(17,33,59,.92),rgba(7,16,31,.94));"
        "border:1px solid var(--line);border-radius:16px;padding:26px;box-shadow:0 28px 80px #0008,"
        "inset 0 1px 0 rgba(255,255,255,.035);backdrop-filter:blur(18px)}}"
        "h1{font-size:24px;line-height:1.2;margin:0;color:#f8fafc;letter-spacing:0}label{display:block;font-weight:600;"
        "margin:0 0 8px;color:#e2e8f0}input{width:100%;padding:12px;background:#020617;"
        "color:#f8fafc;border:1px solid #334155;border-radius:6px;font:inherit;margin-bottom:16px}"
        "input:focus{outline:2px solid #3b82f6;outline-offset:1px}"
        ".settings-button{padding:8px 11px;border-radius:999px;background:#14233a;border-color:var(--line);"
        "color:#d4deec;font-size:11px;white-space:nowrap}.settings-button:hover{background:#1a2e4d}"
        ".modal-backdrop{position:fixed;inset:0;z-index:5;display:none;place-items:center;padding:18px;"
        "background:rgba(1,6,14,.76);backdrop-filter:blur(9px)}.modal-backdrop.open{display:grid}"
        ".password-modal{width:min(460px,100%);background:linear-gradient(145deg,#132541,#091426);"
        "border:1px solid rgba(148,184,224,.22);border-radius:14px;padding:23px;"
        "box-shadow:0 28px 90px #000b,inset 0 1px 0 rgba(255,255,255,.04)}"
        ".modal-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:20px}"
        ".modal-heading h2{font-size:18px;margin:0;color:#f8fafc}.modal-heading p{font-size:12px;color:var(--muted);margin:6px 0 0}"
        ".modal-close{padding:6px 10px;background:#101d31;border-color:var(--line);color:#cbd5e1}"
        ".password-form label{font-size:12px}.password-form input{margin-bottom:14px}"
        ".password-input-wrap{position:relative;margin-bottom:14px}.password-input-wrap input{margin:0;padding-right:48px}"
        ".password-input-wrap input:focus{position:relative;z-index:1}"
        ".password-visibility{position:absolute;z-index:2;right:7px;top:50%;transform:translateY(-50%);"
        "width:34px;height:34px;display:grid;place-items:center;padding:0;border:1px solid transparent;"
        "border-radius:6px;background:transparent;color:#8298b8;transition:color .16s ease,background .16s ease,border-color .16s ease}"
        ".password-visibility:hover{background:#172944;border-color:rgba(148,184,224,.16);color:#dbeafe}"
        ".password-visibility:focus-visible{outline:2px solid #60a5fa;outline-offset:1px}"
        ".password-visibility svg{width:18px;height:18px;display:block;pointer-events:none}"
        ".password-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:4px}"
        ".password-cancel{background:#14233a;border-color:var(--line);color:#cbd5e1}"
        ".password-help{font-size:11px;color:#8293ac;margin:-4px 0 14px}"
        ".toast{position:fixed;z-index:8;right:24px;bottom:24px;width:min(390px,calc(100% - 32px));"
        "padding:13px 16px;border:1px solid rgba(74,222,128,.38);border-left:3px solid #4ade80;"
        "border-radius:9px;background:rgba(10,29,40,.96);color:#dcfce7;box-shadow:0 18px 50px #0008;"
        "opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .22s ease,transform .22s ease}"
        ".toast.show{opacity:1;transform:translateY(0)}.toast.error{background:rgba(55,19,30,.97);"
        "border-color:rgba(251,85,93,.4);border-left-color:#fb555d;color:#fee2e2}"
        "button{border:1px solid #3b82f6;border-radius:6px;padding:12px 16px;background:#2563eb;"
        "color:white;font:650 15px system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer}"
        "button:hover{background:#1d4ed8}button:disabled{opacity:.55;cursor:wait}"
        ".accept{background:#16a34a;border-color:#22c55e}.accept:hover{background:#15803d}"
        ".reject{background:#dc2626;border-color:#ef4444}.reject:hover{background:#b91c1c}"
        ".message{padding:12px 14px;background:rgba(23,37,84,.7);border:1px solid #31539b;border-left:3px solid #60a5fa;"
        "border-radius:8px;margin:0 0 16px;color:#dbeafe;overflow-wrap:anywhere}"
        ".muted{font-size:13px;color:var(--muted)}.top{display:flex;justify-content:space-between;"
        "align-items:center;gap:16px;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:20px}"
        ".brand{display:flex;align-items:center;gap:13px}.brand-mark{width:42px;height:42px;display:grid;place-items:center;"
        "border:1px solid rgba(96,165,250,.35);border-radius:12px;background:rgba(37,99,235,.15);color:#93c5fd}"
        ".brand-mark svg{width:21px;height:21px}.eyebrow{font-size:10px;font-weight:750;color:#7da8e8;"
        "text-transform:uppercase;margin-bottom:5px}.subtitle{font-size:13px;color:var(--muted);margin-top:5px}"
        ".connection{font-size:12px;color:#a6b4c9;border:1px solid var(--line);background:#101d31;"
        "padding:8px 11px;border-radius:999px;white-space:nowrap}.connection:before{content:'';display:inline-block;"
        "width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-right:8px}"
        ".connection.live:before{background:var(--green);box-shadow:0 0 9px #4ade80}"
        ".top-actions{display:flex;align-items:center;gap:9px}.sound-toggle{padding:8px 10px;border-radius:999px;"
        "background:#101d31;border-color:var(--line);font-size:11px;color:#cbd5e1;white-space:nowrap}"
        ".sound-toggle.enabled{color:#bbf7d0;border-color:rgba(74,222,128,.3)}"
        ".dashboard-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:16px}"
        ".dash-card{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:13px;"
        "padding:19px;box-shadow:0 14px 38px #0003,inset 0 1px 0 rgba(255,255,255,.035);backdrop-filter:blur(12px)}"
        ".system-panel{transition:border-color .35s ease,box-shadow .35s ease}"
        ".system-panel.critical{animation:critical-pulse 2.6s ease-in-out infinite}"
        "@keyframes critical-pulse{0%,100%{border-color:rgba(251,85,93,.34);box-shadow:0 14px 38px #0003,0 0 8px rgba(251,85,93,.08)}"
        "50%{border-color:rgba(251,85,93,.9);box-shadow:0 14px 38px #0003,0 0 28px rgba(251,85,93,.3),inset 0 0 18px rgba(251,85,93,.06)}}"
        ".card-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:15px}"
        ".section-title{font-size:15px;font-weight:720;margin:0;color:#f1f5fb}.section-caption{font-size:12px;color:var(--muted);margin-top:5px}"
        ".card-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none;"
        "background:rgba(59,130,246,.12);border:1px solid rgba(96,165,250,.22);color:#93c5fd}"
        ".card-icon svg{width:17px;height:17px}.status-grid{display:grid;grid-template-columns:1fr;gap:9px}"
        ".status-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px 12px;"
        "background:var(--panel-inner);border:1px solid rgba(148,184,224,.12);border-radius:9px;padding:12px 13px;min-width:0}"
        ".status-head{display:flex;align-items:center;gap:10px;min-width:0}.status-icon{width:17px;height:17px;"
        "flex:none;color:#8eacd4}.status-icon svg{width:17px;height:17px;display:block}.status-name{font-size:13px;"
        "font-weight:630;color:#e5edf8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
        ".status-value{grid-column:1;grid-row:2;font-size:12px;color:#bdc9db;padding-left:27px}"
        ".status-details{grid-column:1/-1;font-size:11px;color:#8293ac;overflow-wrap:anywhere;padding-left:27px;margin-top:-3px}"
        ".status-led{grid-column:2;grid-row:1/3;display:flex;align-items:center;gap:8px;font-size:11px;color:#a9b8cc}"
        ".indicator{width:9px;height:9px;flex:none;border-radius:50%;background:#8592a6;box-shadow:0 0 0 3px #8592a61c}"
        ".indicator.good{background:#4ade80;box-shadow:0 0 7px #4ade80,0 0 15px #4ade8070,0 0 0 3px #4ade8024}"
        ".indicator.bad{background:#fb555d;box-shadow:0 0 7px #fb555d,0 0 15px #fb555d70,0 0 0 3px #fb555d24}"
        ".status-updated{font-size:11px;color:#75869f;margin-top:12px}.requests{display:grid;gap:11px}"
        ".request{background:var(--panel-inner);border:1px solid rgba(96,165,250,.22);border-left:3px solid #60a5fa;"
        "border-radius:9px;padding:15px}.amount{font-size:25px;font-weight:750;margin:2px 0 8px;color:#f8fafc}"
        ".details{font-size:12px;color:#b8c6d9}.actions{display:flex;gap:9px;margin-top:15px}"
        ".actions button{flex:1}.empty{padding:28px;text-align:center;color:#94a3b8;"
        "background:rgba(6,15,29,.56);border:1px dashed #334155;border-radius:9px;font-size:13px}"
        ".logout{background:#14233a;border-color:var(--line);color:#cbd5e1;padding:9px 13px;font-size:12px}"
        ".alert-list{display:grid;gap:8px;margin:0 0 12px}.critical-alert{background:rgba(87,25,35,.58);"
        "border:1px solid rgba(251,85,93,.38);border-left:3px solid var(--red);border-radius:8px;padding:11px 12px;color:#fee2e2}"
        ".critical-title{font-size:10px;font-weight:800;text-transform:uppercase;color:#ff9aa0;margin-bottom:3px;letter-spacing:.04em}"
        ".notice{margin-bottom:12px}.hidden{display:none}.dashboard-footer{display:flex;justify-content:flex-end;margin-top:16px}"
        "@media(max-width:760px){body{padding:14px}.dashboard-grid{grid-template-columns:1fr}.panel{padding:19px}.dash-card{padding:16px}}"
        "@media(max-width:520px){.top{align-items:flex-start;flex-direction:column}.actions button{padding:12px 8px}"
        ".connection{align-self:flex-start}.brand-mark{width:38px;height:38px}}"
        "@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}}"
        "</style></head><body>"
        f"<main class='panel'>{content}</main></body></html>"
    )


def _login_page(message: str = "") -> HTMLResponse:
    notice = f"<p class='message'>{html.escape(message)}</p>" if message else ""
    return _page(
        "<h1>Operator sign in</h1>"
        f"{notice}<form method='post' action='/login'>"
        "<label for='password'>Password</label><input id='password' name='password' type='password' "
        "autocomplete='current-password' required autofocus><button type='submit'>Sign in</button></form>"
    )


def _dashboard_page(csrf_token: str) -> HTMLResponse:
    safe_csrf = html.escape(csrf_token, quote=True)
    content = (
        "<header class='top'><div class='brand'><div class='brand-mark'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M12 3 4.5 7v5c0 4.3 3.2 7.7 7.5 9 4.3-1.3 7.5-4.7 7.5-9V7L12 3Z'/><path d='m9 12 2 2 4-4'/></svg></div><div><div class='eyebrow'>PrintPoint · Operations</div><h1>GCash payment approvals</h1>"
        "<div class='subtitle'>Live payment review and kiosk health</div></div></div>"
        "<div class='top-actions'><button id='change-password-open' class='settings-button' type='button'>Change password</button>"
        "<button id='sound-toggle' class='sound-toggle' type='button' aria-pressed='false'>Enable alarm sound</button>"
        "<div id='connection' class='connection'>Connecting to live requests</div></div></header>"
        "<div id='notice' class='message notice hidden' role='status'></div>"
        "<main class='dashboard-grid'><section class='dash-card system-panel' id='system-card' aria-labelledby='system-title'>"
        "<div class='card-heading'><div><h2 id='system-title' class='section-title'>System Status</h2>"
        "<div class='section-caption'>Hardware and print queue health</div></div><div class='card-icon'>"
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M12 8V4'/><path d='M8 4h8'/><rect x='5' y='8' width='14' height='12' rx='2'/><path d='M9 13h6M9 16h4'/></svg>"
        "</div></div><div id='system-status' class='status-grid' aria-live='polite'></div>"
        "<div id='system-checked' class='status-updated'>Waiting for status update</div></section>"
        "<section class='dash-card' aria-labelledby='payments-title'><div class='card-heading'><div>"
        "<h2 id='payments-title' class='section-title'>Incoming payments</h2>"
        "<div class='section-caption'>Verify each transfer in GCash before accepting.</div></div><div class='card-icon'>"
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><rect x='4' y='3' width='16' height='18' rx='2'/><path d='M8 8h8M8 12h3M8 16h2'/><path d='m14 15 1.5 1.5L19 13'/></svg>"
        "</div></div><div id='critical-alerts' class='alert-list' role='alert'></div>"
        "<div id='requests' class='requests' aria-live='polite'></div></section></main>"
        "<div class='dashboard-footer'><form method='post' action='/logout'><button class='logout' type='submit'>Sign out</button></form></div>"
        "<div id='password-modal' class='modal-backdrop' role='presentation'><section class='password-modal' role='dialog' aria-modal='true' aria-labelledby='password-title'>"
        "<div class='modal-heading'><div><h2 id='password-title'>Change password</h2><p>Update the operator password for future sign-ins.</p></div>"
        "<button id='change-password-close' class='modal-close' type='button' aria-label='Close change password dialog'>Close</button></div>"
        "<form id='password-form' class='password-form'><label for='current-password'>Current password</label>"
        "<div class='password-input-wrap'><input id='current-password' name='current_password' type='password' autocomplete='current-password' required>"
        "<button class='password-visibility' type='button' data-password-toggle='current-password' aria-label='Show current password' aria-pressed='false' title='Show password'>"
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/></svg></button></div>"
        "<label for='new-password'>New password</label><div class='password-input-wrap'><input id='new-password' name='new_password' type='password' minlength='10' maxlength='256' autocomplete='new-password' required>"
        "<button class='password-visibility' type='button' data-password-toggle='new-password' aria-label='Show new password' aria-pressed='false' title='Show password'>"
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/></svg></button></div>"
        "<label for='confirm-password'>Confirm new password</label><div class='password-input-wrap'><input id='confirm-password' name='confirm_password' type='password' minlength='10' maxlength='256' autocomplete='new-password' required>"
        "<button class='password-visibility' type='button' data-password-toggle='confirm-password' aria-label='Show confirmation password' aria-pressed='false' title='Show password'>"
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/></svg></button></div>"
        "<div class='password-help'>Use at least 10 characters. The new password will be saved for the next restart.</div>"
        "<div class='password-actions'><button id='password-cancel' class='password-cancel' type='button'>Cancel</button>"
        "<button id='password-save' type='submit'>Save password</button></div></form></section></div>"
        "<div id='toast' class='toast' role='status' aria-live='polite'></div>"
        f"<meta id='operator-csrf' name='operator-csrf' content='{safe_csrf}'>"
        "<script>"
        "const list=document.getElementById('requests');"
        "const notice=document.getElementById('notice');"
        "const connection=document.getElementById('connection');"
        "const passwordModal=document.getElementById('password-modal');"
        "const passwordForm=document.getElementById('password-form');"
        "const passwordSave=document.getElementById('password-save');"
        "const toast=document.getElementById('toast');let toastTimer=null;"
        "const soundToggle=document.getElementById('sound-toggle');"
        "const systemPanel=document.getElementById('system-status');"
        "const systemCard=document.getElementById('system-card');"
        "const systemChecked=document.getElementById('system-checked');"
        "const alerts=document.getElementById('critical-alerts');"
        "const csrf=document.getElementById('operator-csrf').content;"
        "const cards=new Map();"
        "let activeCritical=new Set(),audioContext=null,lastAlarmAt=0,soundEnabled=false;"
        "function showToast(message,isError=false){toast.textContent=message;toast.classList.toggle('error',isError);"
        "toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),4200);}"
        "function closePasswordModal(){passwordModal.classList.remove('open');passwordForm.reset();"
        "document.querySelectorAll('[data-password-toggle]').forEach(button=>{const input=document.getElementById(button.dataset.passwordToggle);"
        "input.type='password';button.innerHTML=eyeOffIcon;button.setAttribute('aria-pressed','false');"
        "button.title='Show password';const label=button.dataset.passwordToggle==='current-password'?'current password':button.dataset.passwordToggle==='new-password'?'new password':'confirmation password';"
        "button.setAttribute('aria-label','Show '+label);});}"
        "const eyeIcon=`<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/></svg>`;"
        "const eyeOffIcon=`<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M3 3l18 18'/><path d='M10.6 10.6a2 2 0 0 0 2.8 2.8'/><path d='M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a14.8 14.8 0 0 1-3.1 3.9'/><path d='M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1 0 1.9-.2 2.7-.5'/></svg>`;"
        "document.querySelectorAll('[data-password-toggle]').forEach(button=>{button.innerHTML=eyeOffIcon;"
        "button.addEventListener('click',()=>{const input=document.getElementById(button.dataset.passwordToggle);"
        "const visible=input.type==='password';input.type=visible?'text':'password';button.innerHTML=visible?eyeIcon:eyeOffIcon;"
        "button.setAttribute('aria-pressed',String(visible));const label=button.dataset.passwordToggle==='current-password'?'current password':button.dataset.passwordToggle==='new-password'?'new password':'confirmation password';"
        "button.setAttribute('aria-label',(visible?'Hide ':'Show ')+label);button.title=visible?'Hide password':'Show password';});});"
        "document.getElementById('change-password-open').addEventListener('click',()=>{passwordModal.classList.add('open');"
        "document.getElementById('current-password').focus();});"
        "document.getElementById('change-password-close').addEventListener('click',closePasswordModal);"
        "document.getElementById('password-cancel').addEventListener('click',closePasswordModal);"
        "passwordModal.addEventListener('click',event=>{if(event.target===passwordModal)closePasswordModal();});"
        "document.addEventListener('keydown',event=>{if(event.key==='Escape')closePasswordModal();});"
        "passwordForm.addEventListener('submit',async event=>{event.preventDefault();"
        "const current=document.getElementById('current-password').value;const next=document.getElementById('new-password').value;"
        "const confirm=document.getElementById('confirm-password').value;"
        "if(next.length<10){showToast('New password must be at least 10 characters.',true);return;}"
        "if(next!==confirm){showToast('New password and confirmation do not match.',true);return;}"
        "passwordSave.disabled=true;try{const response=await fetch('/api/change-password',{method:'POST',"
        "headers:{'Content-Type':'application/json','X-Operator-CSRF':csrf},body:JSON.stringify({current_password:current,new_password:next,confirm_password:confirm})});"
        "const result=await response.json();if(!response.ok)throw new Error(result.detail||'Could not change password.');"
        "closePasswordModal();showToast('Password changed successfully. Use the new password next time you sign in.');"
        "}catch(error){showToast(error.message||'Could not change password.',true);}finally{passwordSave.disabled=false;}});"
        "soundToggle.addEventListener('click',async()=>{try{audioContext=audioContext||new(window.AudioContext||window.webkitAudioContext)();"
        "await audioContext.resume();soundEnabled=true;soundToggle.classList.add('enabled');soundToggle.textContent='Alarm sound on';"
        "soundToggle.setAttribute('aria-pressed','true');}catch(_error){soundToggle.textContent='Sound unavailable';}});"
        "function showNotice(text,isError=false){notice.textContent=text;notice.classList.remove('hidden');"
        "notice.style.borderLeftColor=isError?'#a33a32':'#16724e';}"
        "function showEmpty(){if(cards.size===0){list.innerHTML='';const empty=document.createElement('div');"
        "empty.className='empty';empty.textContent='No GCash payment requests are waiting.';list.appendChild(empty);}}"
        "function playAlarm(){if(!soundEnabled)return;const now=Date.now();if(now-lastAlarmAt<8000)return;lastAlarmAt=now;"
        "try{audioContext=audioContext||new(window.AudioContext||window.webkitAudioContext)();"
        "if(audioContext.state==='suspended')audioContext.resume();const oscillator=audioContext.createOscillator();"
        "const gain=audioContext.createGain();oscillator.type='sine';oscillator.frequency.value=740;"
        "gain.gain.setValueAtTime(.0001,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.08,audioContext.currentTime+.04);"
        "gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+.42);oscillator.connect(gain);gain.connect(audioContext.destination);"
        "oscillator.start();oscillator.stop(audioContext.currentTime+.44);}catch(_error){}}"
        "function renderSystemStatus(data){if(!data||!data.components)return;systemPanel.replaceChildren();"
        "const labels={acceptor:'Acceptor Arduino 1',actuator:'Actuator Arduino 2',printer:'Epson L121 Printer'};"
        "const icons={printer:'<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 9V3h12v6\"/><path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\"/><path d=\"M6 14h12v7H6z\"/><path d=\"M18 12h.01\"/></svg>',"
        "acceptor:'<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><path d=\"M8 7h8M8 11h8M8 15h3\"/><circle cx=\"16\" cy=\"16\" r=\"2\"/></svg>',"
        "actuator:'<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 2v4M12 18v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83\"/><circle cx=\"12\" cy=\"12\" r=\"5\"/><circle cx=\"12\" cy=\"12\" r=\"1\"/></svg>'};"
        "for(const key of ['printer','acceptor','actuator']){const item=data.components[key]||{};"
        "const row=document.createElement('article');row.className='status-row';"
        "const head=document.createElement('div');head.className='status-head';"
        "const icon=document.createElement('span');icon.className='status-icon';icon.innerHTML=icons[key];"
        "const name=document.createElement('div');name.className='status-name';name.textContent=item.name||labels[key];"
        "head.append(icon,name);const value=document.createElement('div');value.className='status-value';value.textContent=item.status||'Unknown';"
        "const led=document.createElement('div');led.className='status-led';const dot=document.createElement('span');"
        "dot.className='indicator '+(item.connected?'good':'bad');dot.setAttribute('aria-label',item.connected?'Online':'Offline or error');"
        "const ledText=document.createElement('span');ledText.textContent=item.connected?'Online':'Attention';led.append(dot,ledText);row.append(head,led,value);"
        "if(item.port){const port=document.createElement('div');port.className='status-details';port.textContent='Port · '+item.port;row.appendChild(port);}"
        "if(item.details){const details=document.createElement('div');details.className='status-details';details.textContent=item.details;row.appendChild(details);}"
        "systemPanel.appendChild(row);}systemChecked.textContent=data.checked_at?'Updated '+new Date(data.checked_at).toLocaleTimeString():'Status received';"
        "const next=new Set((data.critical_alerts||[]).map(item=>item.id));if(next.size){systemCard.classList.add('critical');"
        "for(const id of next){if(!activeCritical.has(id))playAlarm();}}else systemCard.classList.remove('critical');activeCritical=next;}"
        "function renderCriticalAlert(data){if(!data)return;const card=document.createElement('article');card.className='critical-alert';"
        "const title=document.createElement('div');title.className='critical-title';title.textContent='Critical maintenance alert';"
        "const message=document.createElement('div');message.textContent=data.message||'Hardware requires attention.';"
        "card.append(title,message);alerts.prepend(card);systemCard.classList.add('critical');"
        "if(data.id)activeCritical.add(data.id);playAlarm();}"
        "function renderHopperEvent(data){if(!data)return;const kind=data.event;"
        "if(kind==='dispensing_change'){showNotice('Dispensing change for session '+String(data.session_id||'').slice(0,8)+'.');return;}"
        "if(kind==='session_reset'){showNotice('Change confirmed. Kiosk session completed.');return;}"
        "const failed=['hopper_error','change_dispense_failed'].includes(kind);"
        "const denomination=data.denomination?'PHP '+data.denomination+' hopper':'Coin hopper';"
        "showNotice(failed?(data.message||denomination+' dispense failed. Check coin path and sensor.'):'Change coin delivery confirmed.',failed);if(failed)playAlarm();}"
        "function renderRequest(item){if(!item||!item.session_id||cards.has(item.session_id))return;"
        "const empty=list.querySelector('.empty');if(empty)empty.remove();"
        "const card=document.createElement('article');card.className='request';"
        "const amount=document.createElement('div');amount.className='amount';"
        "amount.textContent='PHP '+Number(item.amount||0).toFixed(2);card.appendChild(amount);"
        "const detail=document.createElement('div');detail.className='details';"
        "detail.textContent=[item.file_name||'Print job',item.page_count?item.page_count+' page(s)':null,"
        "item.copies?item.copies+' copy/copies':null].filter(Boolean).join(' · ');card.appendChild(detail);"
        "const actions=document.createElement('div');actions.className='actions';"
        "const accept=document.createElement('button');accept.type='button';accept.textContent='Accept';accept.className='accept';"
        "const reject=document.createElement('button');reject.type='button';reject.textContent='Reject';reject.className='reject';"
        "async function decide(action){accept.disabled=true;reject.disabled=true;try{"
        "const response=await fetch('/action',{method:'POST',headers:{'Content-Type':'application/json',"
        "'X-Operator-CSRF':csrf},body:JSON.stringify({session_id:item.session_id,action})});"
        "const result=await response.json();if(!response.ok)throw new Error(result.detail||'Request failed');"
        "card.remove();cards.delete(item.session_id);showNotice(action==='accept'?'Payment accepted. The kiosk can continue printing.':'Payment rejected. The kiosk has been notified.');showEmpty();"
        "}catch(error){accept.disabled=false;reject.disabled=false;showNotice(error.message||'Could not update payment.',true);}}"
        "accept.addEventListener('click',()=>decide('accept'));reject.addEventListener('click',()=>decide('reject'));"
        "actions.append(accept,reject);card.appendChild(actions);cards.set(item.session_id,card);list.appendChild(card);}"
        "const stream=new EventSource('/events');"
        "stream.addEventListener('snapshot',event=>{JSON.parse(event.data).forEach(renderRequest);showEmpty();});"
        "stream.addEventListener('payment_request',event=>renderRequest(JSON.parse(event.data)));"
        "stream.addEventListener('system_status',event=>renderSystemStatus(JSON.parse(event.data)));"
        "stream.addEventListener('critical_alert',event=>renderCriticalAlert(JSON.parse(event.data)));"
        "stream.addEventListener('hopper_event',event=>renderHopperEvent(JSON.parse(event.data)));"
        "stream.onopen=()=>{connection.textContent='Live requests connected';connection.classList.add('live');};"
        "stream.onerror=()=>{connection.textContent='Reconnecting to live requests';connection.classList.remove('live');};"
        "showEmpty();</script>"
    )
    return _page(content, dashboard=True)


def _authorized_token(provided: str | None) -> bool:
    expected = settings.GCASH_CONFIRM_TOKEN
    return bool(expected and provided and secrets.compare_digest(provided, expected))


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    session = _valid_session(request)
    return _dashboard_page(session[1]) if session else _login_page()


@app.post("/login", response_class=HTMLResponse)
def login(password: str = Form(...)):
    configured_password = settings.GCASH_CONFIRM_PASSWORD
    if not configured_password:
        return _login_page("Operator login is not configured. Set GCASH_CONFIRM_PASSWORD.")
    if not secrets.compare_digest(password, configured_password):
        return _login_page("Incorrect password.")

    token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(24)
    _operator_sessions[token] = (csrf_token, time.time() + SESSION_TTL_SECONDS)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        "gcash_operator",
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="strict",
        secure=False,
        path="/",
    )
    return response


@app.post("/api/change-password")
async def change_password(
    request: Request,
    csrf_token: str | None = Header(default=None, alias="X-Operator-CSRF"),
):
    operator = _valid_session(request)
    if not operator or not csrf_token or not secrets.compare_digest(csrf_token, operator[1]):
        return JSONResponse({"detail": "Your operator session expired. Sign in again."}, status_code=401)

    try:
        payload = await request.json()
        current_password = payload.get("current_password")
        new_password = payload.get("new_password")
        confirm_password = payload.get("confirm_password")
    except (ValueError, AttributeError):
        return JSONResponse({"detail": "Invalid password update request."}, status_code=400)

    if not all(isinstance(value, str) for value in (current_password, new_password, confirm_password)):
        return JSONResponse({"detail": "All password fields are required."}, status_code=400)
    if not secrets.compare_digest(current_password, settings.GCASH_CONFIRM_PASSWORD):
        return JSONResponse({"detail": "Current password is incorrect."}, status_code=403)
    if new_password != confirm_password:
        return JSONResponse({"detail": "New password and confirmation do not match."}, status_code=400)
    if len(new_password) < 10 or len(new_password) > 256:
        return JSONResponse({"detail": "New password must be between 10 and 256 characters."}, status_code=400)
    if secrets.compare_digest(current_password, new_password):
        return JSONResponse({"detail": "Choose a password different from the current password."}, status_code=400)

    try:
        await asyncio.to_thread(
            set_key,
            str(APP_ROOT / ".env"),
            "GCASH_CONFIRM_PASSWORD",
            new_password,
            "always",
            False,
        )
    except OSError:
        logger.exception("Unable to persist operator password")
        return JSONResponse({"detail": "Could not save the new password. Check .env file permissions."}, status_code=500)

    settings.GCASH_CONFIRM_PASSWORD = new_password
    current_token = operator[0]
    for token in tuple(_operator_sessions):
        if token != current_token:
            _operator_sessions.pop(token, None)
    return {"success": True}


@app.post("/internal/payment-request")
async def receive_payment_request(
    request: Request,
    confirmation_token: str | None = Header(default=None, alias="X-GCash-Confirm-Token"),
):
    if not _authorized_token(confirmation_token):
        return JSONResponse({"detail": "Invalid GCash confirmation credentials."}, status_code=401)
    try:
        payload = await request.json()
        session_id = str(payload.get("session_id", "")).strip()
        amount = float(payload.get("amount", 0))
        if not session_id or len(session_id) > 128 or amount <= 0:
            raise ValueError("invalid payment request")
    except (ValueError, TypeError, AttributeError):
        return JSONResponse({"detail": "Invalid payment request."}, status_code=400)

    notification = {
        "session_id": session_id,
        "amount": amount,
        "file_name": str(payload.get("file_name") or "Print job")[:120],
        "page_count": payload.get("page_count"),
        "copies": payload.get("copies"),
        "timestamp": time.time(),
    }
    _pending_requests[session_id] = notification
    for queue in tuple(_event_queues):
        queue.put_nowait({"event": "payment_request", "data": notification})
    return {"success": True}


@app.post("/internal/system-status")
async def receive_system_status(
    request: Request,
    confirmation_token: str | None = Header(default=None, alias="X-GCash-Confirm-Token"),
):
    global _latest_system_status
    if not _authorized_token(confirmation_token):
        return JSONResponse({"detail": "Invalid GCash confirmation credentials."}, status_code=401)
    try:
        message = await request.json()
        event_type = message.get("type")
        data = message.get("data")
        if event_type not in {"system_status", "critical_alert", "hopper_event"} or not isinstance(data, dict):
            raise ValueError("invalid system event")
    except (ValueError, TypeError, AttributeError):
        return JSONResponse({"detail": "Invalid system status event."}, status_code=400)

    if event_type == "system_status":
        components = data.get("components")
        if not isinstance(components, dict):
            return JSONResponse({"detail": "System status components are required."}, status_code=400)
        _latest_system_status = data
    for queue in tuple(_event_queues):
        queue.put_nowait({"event": event_type, "data": data})
    return {"success": True}


@app.get("/events")
async def events(request: Request):
    if not _valid_session(request):
        return JSONResponse({"detail": "Operator login required."}, status_code=401)

    queue: asyncio.Queue = asyncio.Queue()
    _event_queues.add(queue)

    async def stream():
        try:
            snapshot = json.dumps(list(_pending_requests.values()), separators=(",", ":"))
            yield f"event: snapshot\ndata: {snapshot}\n\n"
            system_status = json.dumps(_latest_system_status, separators=(",", ":"))
            yield f"event: system_status\ndata: {system_status}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15)
                    data = json.dumps(message["data"], separators=(",", ":"))
                    yield f"event: {message['event']}\ndata: {data}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            _event_queues.discard(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/action")
async def payment_action(
    request: Request,
    csrf_token: str | None = Header(default=None, alias="X-Operator-CSRF"),
):
    operator = _valid_session(request)
    if not operator or not csrf_token or not secrets.compare_digest(csrf_token, operator[1]):
        return JSONResponse({"detail": "Operator session expired. Sign in again."}, status_code=401)

    try:
        body = await request.json()
        session_id = str(body.get("session_id", "")).strip()
        action = body.get("action")
    except (ValueError, AttributeError):
        return JSONResponse({"detail": "Invalid action request."}, status_code=400)

    if action not in {"accept", "reject"} or session_id not in _pending_requests:
        return JSONResponse({"detail": "This payment request is no longer pending."}, status_code=409)
    if not settings.GCASH_CONFIRM_TOKEN:
        return JSONResponse({"detail": "Server confirmation is not configured."}, status_code=503)

    endpoint = "manual-confirm" if action == "accept" else "manual-reject"
    try:
        response = requests.post(
            f"{settings.KIOSK_BACKEND_URL.rstrip('/')}/api/payment/{quote(session_id, safe='')}/{endpoint}",
            json={},
            headers={"X-GCash-Confirm-Token": settings.GCASH_CONFIRM_TOKEN},
            timeout=5,
        )
        response.raise_for_status()
        result = response.json()
        if not result.get("success"):
            raise ValueError("Kiosk backend did not update the payment")
    except requests.HTTPError as exc:
        detail = "Kiosk backend rejected the action."
        try:
            detail = exc.response.json().get("error", detail)
        except (AttributeError, ValueError):
            pass
        return JSONResponse({"detail": detail}, status_code=exc.response.status_code)
    except (requests.RequestException, ValueError) as exc:
        return JSONResponse({"detail": f"Could not reach kiosk backend: {exc}"}, status_code=502)

    _pending_requests.pop(session_id, None)
    return {"success": True, "action": action}


@app.post("/logout")
def logout(request: Request):
    token = request.cookies.get("gcash_operator")
    _operator_sessions.pop(token or "", None)
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie("gcash_operator", path="/")
    return response


if __name__ == "__main__":
    uvicorn.run(app, host=settings.GCASH_CONFIRM_HOST, port=settings.GCASH_CONFIRM_PORT)
