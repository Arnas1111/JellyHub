// A controlled browser clock verifies 20-second rotation without a long wall-clock wait.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir=await mkdtemp(path.join(os.tmpdir(),'jellyhub-carousel-'));
const child=spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{env:{...process.env,PORT:'0',CONFIG_DIR:dir}});
let browser;
try{
  const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timeout')),10000);child.on('exit',()=>{clearTimeout(timeout);reject(Error('Server exited'))});child.stdout.on('data',data=>{const match=String(data).match(/running on :(\d+)/);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`)}})});
  browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{});
  const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});
  const start=new Date('2026-11-14T12:00:00Z');await page.clock.install({time:start});await page.clock.pauseAt(start);
  let failFeatured=false;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname==='/api/branding')return reply({name:'JellyHub',title:'JellyHub',accent:'#9980ff',welcome:'Home',favicon:'/favicon.svg',logo:'/branding-logo'});
    if(url.pathname==='/api/me')return reply({id:'viewer',name:'Viewer',admin:false});
    if(url.pathname==='/api/home')return reply({recent:[],resume:[]});
    if(url.pathname==='/api/discover')return reply({movies:[],shows:[]});
    if(url.pathname==='/api/featured')return failFeatured?reply({error:'Unavailable'},503):reply({items:Array.from({length:8},(_,i)=>({Id:'movie'+i,Name:'Movie '+(i+1),Type:'Movie'})),source:'library',reshuffleAt:new Date('2026-11-14T13:00:00Z').getTime()});
    if(url.pathname.startsWith('/api/backdrop/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><path fill="#173042" d="M0 0h160v90H0z"/></svg>'});
    return reply({error:'Unexpected request'},404);
  });
  await page.goto(base);await page.locator('.feature-slide').waitFor();await page.mouse.move(0,0);
  const active=()=>page.locator('.carousel-dot[aria-current="true"]').getAttribute('aria-label');
  await page.clock.runFor(10000);assert.match(await active(),/^Show featured title 1:/);
  assert.ok(Number(await page.locator('.feature-progress').getAttribute('aria-valuenow'))>=49);
  await page.locator('.featured').hover();const before=await page.locator('.feature-progress').getAttribute('aria-valuenow');await page.clock.runFor(40000);
  assert.equal(await page.locator('.feature-progress').getAttribute('aria-valuenow'),before);assert.match(await active(),/^Show featured title 1:/);
  await page.mouse.move(0,0);await page.clock.runFor(9000);assert.match(await active(),/^Show featured title 1:/);assert.ok(Number(await page.locator('.feature-progress').getAttribute('aria-valuenow'))>=94,'Hover must preserve elapsed time rather than restarting the interval');
  await page.clock.runFor(1200);await page.getByRole('heading',{name:'Movie 2',exact:true}).waitFor();assert.match(await active(),/^Show featured title 2:/);
  assert.ok(Number(await page.locator('.feature-progress').getAttribute('aria-valuenow'))<5);
  failFeatured=true;await page.reload();await page.getByRole('heading',{name:'Explore your library.',exact:true}).waitFor();assert.equal((await page.locator('.featured').boundingBox()).height,480,'Failure state must retain the same reserved stage');
  console.log('Carousel clock checks passed: 20-second cadence, hover freezes and resumes remaining time, progress resets on advance, and failure state preserves layout.');
}finally{await browser?.close();if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit}await rm(dir,{recursive:true,force:true})}
