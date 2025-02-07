
let inspector = {};
console.log( "load bg.js" );
// javascript-obfuscator:disable
async function show_inspector( tabid,inspector )
{
    inspector = new DomInspector({
        maxZIndex: 9999,
        onClick: async (path) => {
            const url = 'index.html#/check/add?path='+encodeURIComponent(path)+'&title='+encodeURIComponent(window.document.title)+'&url='+encodeURIComponent(window.location.href);
            console.log( url );
            // 这里是 content script 同等权限，发送消息来调整网页
            const ret = await chrome.runtime.sendMessage({action: "redirect","url":url,"tabid":tabid},);
            console.log( "ret" , ret, inspector );
            // 因为给元素注入了onclick，这里还是要reload才行
            window.location.reload();
        }
    });
    inspector.enable();
    alert("可视化选择器已初始化，请移动鼠标选择要监测的区域后点击，取消请按ESC");
    console.log( "inspector2", inspector );
    document.addEventListener('keyup',e => {
        if (e.key === "Escape") inspector.disable();
   });
}

// javascript-obfuscator:disable
async function ck_get_content( path,delay=3000 )
{
    function sleep(ms) {
        return new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
    }

    function dom_ready(ms)
    {
        return new Promise((resolve) => {
            const handle = setInterval( ()=>{ 
                console.log( document.readyState );
                if( document.readyState == 'complete' )
                {
                    clearInterval(handle);
                    resolve(true);
                }
            } , 1000 );
            if(ms) setTimeout(resolve, ms);
        });
    }

    function dom_mul_select( path )
    {
        let ret = window.document.querySelectorAll(path);
        if( !ret ) return false;
        let texts = [];
        let html = "";
        for( let item of ret )
        {
            item.querySelectorAll("[src]").forEach( item => { if( item.src.substr(0,4) != 'http' ) { item.src = window.origin +( item.src.substr(0,1) == '/' ? item.src : '/'+ item.src  )   } } );
            
            if( item.innerText ) texts.push(item.innerText?.trim());
            html += item.outerHTML ? item.outerHTML + "<br/>" : ""; 
        }
        return {text:path.indexOf(",") >= 0 ? texts.join("\n") :texts[0]||"",html};
    }
    
    // await sleep(delay);
    await dom_ready();
    if( delay > 0 ) await sleep(delay);
    const ret = dom_mul_select(path);
    // 直接提取
    if( ret )
    {
        return ret;
    }
    else
    {
        // 失败的话，先延迟再尝试一次
        await sleep(3000);
        const ret2 = dom_mul_select(path);
        if( ret2  )
        {
            return ret2;
        }
        else
        {
            await sleep(3000);
            // 再来一次
            const ret3 = dom_mul_select(path);
            if( ret3  ) return ret;
        }
        
    }

    return false;
    
    
}



chrome.runtime.onMessage.addListener( (request, sender, sendResponse) => {
    
    // console.log("in event listender", request);
    if (request.action === "redirect")
    {
        (async () =>{
            // 必须用update，直接给属性赋值没有用
            // 如果已经打开了窗口，重用窗口
            const [tab] = await chrome.tabs.query({ title:"Check酱" });
            // 否则创建一个信息的
            const tab2 = await chrome.tabs.get(request.tabid);
            console.log(tab2);

            const that_tab = tab || tab2;
            // 重用模式下，刷新定位窗口
            // 不用刷新了，加了esc
            // if( tab )
            // {
            //     await chrome.tabs.reload(tab2.id);
            // }

            // await chrome.tabs.update(that_tab.id, {"url":request.url+'&icon='+encodeURIComponent(that_tab.favIconUrl),"active":true});
            // 不传递favicon了
            await chrome.tabs.update(that_tab.id, {"url":request.url,"active":true});
            // 强制刷新时hash值生效
            await chrome.tabs.reload(that_tab.id);
            sendResponse({"message":"done",request});
        })();
        return true;
    }
    if (request.action === "fetch")
    {
        (async () =>{
            const tab = await chrome.tabs.create({"url":request.url,"active":false,"pinned":true});

            // console.log("request",request);
            if( request.ua )
            {
                await attach_debugger( tab.id );
                await send_debug_command(tab.id, 'Network.setUserAgentOverride', {
                    userAgent: request.ua,
                });
                // console.log("reload");
                await chrome.tabs.reload(tab.id);
                await sleep(1000);

            }
            // console.log( tab );
            // javascript-obfuscator:disable
            const r = await chrome.scripting.executeScript(
            {
                    target: {tabId: tab.id},
                    function: ck_get_content,
                    args: [request.path,request.delay]
            });
            //  console.log( r );
           
            if( request.ua ) await detach_debugger(tab.id);
            
            const result = r[0]?.result;
            console.log( "result", result );
            await chrome.tabs.remove(tab.id);
            sendResponse( result );
        })();
        
        return true;

        
    }
    sendResponse({});
    return true;
});

chrome.action.onClicked.addListener(function(activeTab)
{
    tab_init();
});

chrome.runtime.onInstalled.addListener(function (details)
{
    // 在安装完成事件后
    chrome.contextMenus.create({
        // "id": `checkchanSelector-${Date.now()}`,
        "id": `checkchanSelector`,
        "title": "定位监测对象",
        "contexts": ["all"]
    });
    // 只创建一次
    chrome.alarms.create('check_change', 
    {
        when: Date.now(),
        periodInMinutes: 1
    });

    // chrome.alarms.create('auto_sync', 
    // {
    //     when: Date.now(),
    //     periodInMinutes: 10
    // });

    chrome.alarms.create('bg_cookie_sync', 
    {
        when: Date.now(),
        periodInMinutes: 61
    });

    console.log("create alarms");
    tab_init();
});

function send_debug_command(tabid, method, params = {}) {
    return new Promise((resolve) => {
      chrome.debugger.sendCommand({ tabId:tabid }, method, params, resolve);
    });
}

function attach_debugger(tabId, prevTab) {
    return new Promise((resolve) => {
      if (prevTab && tabId !== prevTab)
        chrome.debugger.detach({ tabId: prevTab });
  
      chrome.debugger.attach({ tabId }, '1.3', () => {
        chrome.debugger.sendCommand({ tabId }, 'Page.enable', resolve);
      });
    });
}

function detach_debugger(tabId) {
    return new Promise((resolve) => {
        chrome.debugger.detach({ tabId },resolve);
    });
}

async function tab_init()
{
    // 首先查找名为[Check酱]的tab，没有再创建新的
    const [tab] = await chrome.tabs.query({ title:"Check酱" });
    // console.log( tab );
    if( tab )
    {
        await chrome.tabs.update(tab.id, {"active":true});
        // await chrome.tabs.update(tab.id, {"highlighted":true});
    }else
    {
        await chrome.tabs.create({"url":"index.html","pinned":true});
    }

}


function selector_init( tabid )
{
    chrome.scripting.executeScript(
        {
            target: {tabId: tabid},
            // files: ['init.js']
            function: show_inspector,
            args: [tabid,inspector]
        },
        (injectionResults)=>
        {
            console.log(injectionResults);
        }
    );
}





chrome.contextMenus.onClicked.addListener(async(e)=>{
    console.log("menu clicked", e);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    selector_init(tab.id);
});

function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
}

// chrome.webRequest.onBeforeSendHeaders.addListener(
//     async details => 
//     {
//         let headers = details.requestHeaders;
//         const checks = (await load_data('checks')).filter( item => item.ua );
//         if( checks.length > 0 )
//         {
//             const domains = checks.map( item => new URL(item.url).host );
//             const uas = checks.map( item => item.ua );
//             // console.log( domains, uas );
//             for (var i = 0; i < headers.length; ++i) 
//             {
//                 if (headers[i].name.toLowerCase() === 'user-agent') 
//                 {
//                     const host = new URL(details.url).host;
//                     if( domains.includes(host) )
//                     {
//                         headers[i].value = uas[domains.indexOf(host)];
//                         console.log("change headers", details.url , headers[i]);
//                     }
                    
                    
//                 }
//             }
//         }
       
//         return {requestHeaders: headers};
//     },
//     {urls: ["<all_urls>"]},
//     ["requestHeaders"]
//   );

chrome.alarms.onAlarm.addListener( async a =>
{
    if( a.name == 'bg_cookie_sync' )
    {
        console.log( 'bg_cookie_sync' );
        // 读取api
        const settings = await kv_load('settings');
        if( !settings._hosted_api_base ) return false;
        // 开关
        if( parseInt( settings._hosted_auto_sync||0 ) <= 0 || parseInt( settings._hosted_sync_cookie||0 ) <= 0 ) return false;

        console.log( 'bg_cookie_sync start', parseInt( settings._hosted_auto_sync||0 ), parseInt( settings._hosted_sync_cookie||0 )  );
        
        // 读取 checks
        const checks = await load_data('checks');

        // 获取 cookie
        const cookies = parseInt( settings._hosted_sync_cookie ) > 0 ? await get_cookie_by_checks( checks ) : [];

        // 同步 checks 和 cookies
        const form = new FormData();
        form.append( 'key',settings._hosted_api_key||"" ); 
        form.append( 'checks',JSON.stringify(checks) ); 
        form.append( 'cookies',JSON.stringify(cookies) );
        try {
            const response = await fetch( settings._hosted_api_base+'/checks/upload', {
                method: 'POST', 
                body: form
            } );

            const ret = await response.json();
            console.log( "ret", ret );
            return ret;
            
        } catch (error) {
            console.log("请求服务器失败。"+error);
            return false;
        }

    }    
});

async function kv_save( data, key = 'settings' )
{
    let kv = [];
    for( const setting of data )
    {
        kv.push({"key":setting,"value":this[setting]});
    }
    await save_data(kv, key);
}

async function kv_load( key = 'settings' )
{
    let opt = {};
    const kv = await load_data( key );

    if( kv && Array.isArray(kv) )
    for( const item of kv )
    {
        if( item.key )
            opt[item.key] = item.value || "";
    }

    return opt;
}

async function get_cookie_by_checks( checks )
{
    let ret_cookies = {};
    // 获取cookie
    if( chrome.cookies )
    {
        const cookies = await chrome.cookies.getAll({});
        let domains = [];
        for( const item of checks )
        {
            // console.log( "item", item );
            const domain = new URL( item.url ).host;
            if( !domains.includes( domain ) )
                domains.push( domain );
        }
        // console.log( domains );
        for( const domain of domains )
        {
            ret_cookies[domain] = [];
            for( const cookie of cookies )
            {
                // console.log( "cookie", cookie, domain, domain.indexOf(cookie.domain) );
                if( domain.indexOf(cookie.domain) >= 0 )
                {
                    ret_cookies[domain].push( cookie );
                }
            }    
        }
    }else
    {
        console.log("not chrome cookie...");
    }
    return ret_cookies;
}

async function storage_set( key, value )
{
    return new Promise((resolve, reject) => {
        chrome.storage.local.set( {[key]:value}, function () {
          return resolve(true);
        });
      });
}

async function storage_get( key )
{
    return new Promise((resolve, reject) => {
        chrome.storage.local.get([key], function (result) {
          if (result[key] === undefined) {
            resolve(null);
          } else {
            resolve(result[key]);
          }
        });
      });
}

async function load_data( key = 'checks' )
{
    const data = chrome?.storage ? await storage_get(key) : window.localStorage.getItem( key );
    // console.log("load",key,data);
    try {
        return JSON.parse(data);
    } catch (error) {
        return data||[];
    }

}

async function save_data( data, key = 'checks')
{
    // chrome.storage.local.set({key:JSON.stringify(data)});
    const ret = chrome?.storage ? await storage_set( key, JSON.stringify(data) )  : window.localStorage.setItem( key, JSON.stringify(data) );
    return ret;
}