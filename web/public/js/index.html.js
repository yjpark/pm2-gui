"use strict";

var sysStat,
    sockets   = {},
    pageIndex = 1,
    pageLoaded,
    procAnimated,
    procs,
    prevProcs,
    tmps      = {},
    eles      = {},
    timer,
    popupShown,
    popupProc,
    scrolled;

/**
 * Initialization.
 */
$(window).ready(function(){

  prepareDOM();

  initFullPage();

  listenSocket();

});

/**
 * Prepare DOM, cache elements, templates...
 */
function prepareDOM(){
  eles = {
    fpNav             : $('#fp-nav'),
    procs             : $('.procs').eq(0),
    procsHintContainer: $('.procs-hint-container').eq(0)
  };

  eles.procsHint = eles.procsHintContainer.find('div').eq(0);
  eles.procsHintNum = eles.procsHintContainer.find('span').eq(0);

  // Enable/Disable when mouseenter/mouseleave processes list.
  eles.procs.hover(function(){
    !popupShown && setFPEnable(false, true);
  }, function(){
    !popupShown && setFPEnable(true, true);
  });

  tmps = {
    proc  : _.template($('#procTmp').html()),
    noproc: $('#noProcTmp').html(),
    popup : _.template($('#popupTmp').html())
  };
}

/**
 * Initialize fullPage plugin.
 */
function initFullPage(){
  $('#fullpage').fullpage({
    sectionsColor     : ['#303552', '#3b4163'],
    navigation        : true,
    navigationPosition: 'right',
    navigationTooltips: ['System Stat', 'Processes'],
    afterLoad         : function(){
      pageLoaded = true;
    },
    onLeave           : function(index, nextIndex, direction){
      pageIndex = nextIndex;
      pageLoaded = false;

      if (nextIndex == 2) {
        // Update processes' layout without animation.
        updateProcsLayout(true);

        if (!procAnimated) {
          // Animate processes' layout with bounceInDown.
          procAnimated = true;
          animate(eles.procs, 'bounceInDown');
        }
      }
    }
  });

  // Disable fullPage.
  setFPEnable(false);
}

/**
 * Set fullPage enable or disable.
 * @param {Boolean} enable
 * @param {Boolean} exceptScroll
 */
function setFPEnable(enable, exceptScroll){
  $.fn.fullpage.setAllowScrolling(enable);
  if (!exceptScroll) {
    $.fn.fullpage.setKeyboardScrolling(enable);
    eles.fpNav[enable ? 'fadeIn' : 'fadeOut']();
  }
}

/**
 * Initialize socket.io client and add listeners.
 */
function listenSocket(){
  sockets.sys = io('/sys', {path: url_prefix + "/socket.io"}); //SG Changed

  // error handler.
  sockets.sys.on('error', function(err){
    info(err.message);
  });
  // information from server.
  sockets.sys.on('info', info);
  // processes
  sockets.sys.on('procs', onProcsChange);

  // The first time to request system state.
  sockets.sys.on('system_stat', onSysStat);

  function onSysStat(data){
    // Remove listen immediately.
    sockets.sys.removeEventListener('system_stat', onSysStat);

    // Store system states.
    sysStat = data;

    // Render polar chart.
    polarUsage();

    // Bind system information.
    var tmp = _.template($('#sysInfoTmp').html());
    $('.system-info').html(tmp({
      data: {
        cpu   : sysStat.cpus.length,
        arch  : sysStat.arch,
        uptime: fromNow(sysStat.uptime),
        memory: getMem(sysStat.memory.total)
      }
    })).css('opacity', 0.01).show().animate({
      opacity  : 1,
      marginTop: -40
    });

    // Enable fullPage.
    setFPEnable(true);

    // Remove loading.
    $('.spinner').remove();
  }

  sockets.sys.on('pm2_ver', function(ver){
    $('.repo > span').text('PM2 v' + ver);
  });

  // Show alert when stopping process by pm_id failed.
  sockets.sys.on('action', function(id, errMsg){
    info(errMsg);
    $('#proc_' + id).find('.proc-ops').find('.load').fadeOut(function(){
      $(this).prev().fadeIn().end().fadeOut(function(){
        $(this).remove();
      });
    });
  });
}

/**
 * Render polar charset of usage (CPU and memory).
 */
function polarUsage(){
  if (!sysStat) {
    return;
  }
  var width = 520,
      height = 520,
      radius = Math.min(width, height) / 2,
      spacing = .15;

  // Usage colors - green to red.
  var color = d3.scale.linear()
    .range(['hsl(-270,50%,50%)', 'hsl(0,50%,50%)'])
    .interpolate(function(a, b){
      var i = d3.interpolateString(a, b);
      return function(t){
        return d3.hsl(i(t));
      };
    });

  // Transform percentage to angle.
  var arc = d3.svg.arc()
    .startAngle(0)
    .endAngle(function(d){
      return d.value * 2 * Math.PI;
    })
    .innerRadius(function(d){
      return d.index * radius;
    })
    .outerRadius(function(d){
      return (d.index + spacing) * radius;
    });

  // Initialize polar.
  var svg = d3.select('.polar-usage').style({
    height: height + 'px',
    width : width + 'px'
  }).append('svg')
    .attr('width', width)
    .attr('height', height)
    .append('g')
    .attr('transform', 'translate(' + width / 2 + ',' + height / 2 + ')');

  // Text of hostname.
  svg.append('text')
    .attr('dy', 0)
    .text(sysStat.hostname);

  // Text of platform and release
  svg.append('text')
    .attr('dy', 20)
    .style('fill', '#ccc')
    .text(sysStat.platform + ' ' + sysStat.release);

  // Initialize CPU and Memory fields.
  var field = svg.selectAll('g')
    .data(fields)
    .enter().append('g');

  field.append('path');
  field.append('text');

  // Render it.
  d3.transition().duration(0).each(refresh);

  // arcTween
  function arcTween(d){
    var i = d3.interpolateNumber(d.previousValue, d.value);
    return function(t){
      d.value = i(t);
      return arc(d);
    };
  }

  // Real-time.
  function fields(){
    return [
      {index: .7, text: 'CPU ' + sysStat.cpu + '%', value: sysStat.cpu / 100},
      {index: .4, text: 'MEM ' + sysStat.memory.percentage + '%', value: sysStat.memory.percentage / 100}
    ];
  }

  // Refresh system states.
  function refresh(){
    field = field
      .each(function(d){
        this._value = d.value;
      })
      .data(fields)
      .each(function(d){
        d.previousValue = this._value;
      });

    field.select('path')
      .transition()
      .ease('elastic')
      .attrTween('d', arcTween)
      .style('fill', function(d){
        return color(d.value);
      });

    field.select('text')
      .attr('dy', function(d){
        return d.value < .5 ? '0' : '10px';
      })
      .text(function(d){
        return d.text;
      })
      .transition()
      .ease('elastic')
      .attr('transform', function(d){
        return 'rotate(' + 360 * d.value + ') ' +
          'translate(0,' + -(d.index + spacing / 2) * radius + ') ' +
          'rotate(' + (d.value < .5 ? -90 : 90) + ')'
      });
  }

  // When receiving data from server, refresh polar.
  sockets.sys.on('system_stat', function(data){
    if (pageIndex != 1) {
      return;
    }
    var changed = sysStat.cpu != data.cpu || sysStat.memory.percentage != data.memory.percentage;
    sysStat = data;

    changed && refresh();
  });
}

/**
 * Be triggered after processes have been changed.
 * @param _procs
 */
function onProcsChange(_procs){
  // Stora processes.
  procs = {
    data: _procs.filter(function(p){
      return !!p;
    }),
    tick: Date.now()
  };

  // Compare ticks to make sure there has any change.
  var isProcsChanged = eles.procsHint.data('tick') != procs.tick;

  if (!isProcsChanged) {
    return;
  }

  if (pageIndex == 1) {
    // Update processes count only on fullPage 1 (with animation).
    updateProcsCount(true);
  } else if (pageIndex == 2) {
    // Update processes count on fullPage 1 (without animation).
    updateProcsCount();
    // Update processes' layout on fullPage 2.
    updateProcsLayout();
  }
}

/**
 * Update processes count.
 * @param {Boolean} withAnimation
 */
function updateProcsCount(withAnimation){
  var len = procs.data.length;
  // If there has no change, return it.
  if (eles.procsHintContainer.data('count') == len) {
    return;
  }
  // Store count to element.
  eles.procsHintContainer.data('count', len).removeClass('hide');
  // Reset count.
  eles.procsHintNum.text(len);
  // Shake it if necessary.
  withAnimation && animate(eles.procsHint, 'shake');
}

/**
 * Update the processes' layout.
 * @param {Boolean} noAnimation
 * @returns {*}
 */
function updateProcsLayout(noAnimation){
  // If has no change, return it.
  if (!procs || eles.procs.data('tick') == procs.tick) {
    return cloneProcs();
  }

  // Store tick.
  eles.procs.data('tick', procs.tick);

  // Has process or not.
  var noprocRendered = eles.procs.data('empty'),
      isEmpty = eles.procs.is(':empty');

  // If there has no process.
  if (procs.data.length == 0) {
    // And the `empty tip` is rendered, return it.
    if (noprocRendered) {
      return cloneProcs();
    }
    // It's an empty list.
    eles.procs.data('empty', true);

    // destroy slimScroll if necessary.
    destroySlimScroll();

    // Render `empty tip`.
    $(tmps.noproc).prependTo(eles.procs);

    // Remove previous processes list.
    if (!isEmpty) {
      !noAnimation && animate(eles.procs, 'flip');
      eles.procs.find('.proc,.proc-div').not('.proc-empty').remove();
    }
    return cloneProcs();
  }

  // If there have processes and the `empty tip` is rendered.
  if (noprocRendered) {
    // Remove empty data.
    eles.procs.removeData('empty');
    // Create processes' layout.
    createProcs(procs.data, noprocRendered, noAnimation);
    return cloneProcs();
  }

  // If there has no process and never render `empty tip`.
  if (isEmpty) {
    // Create processes' layout.
    createProcs(procs.data, noprocRendered, noAnimation);
    return cloneProcs();
  }

  // Read existing processes' Uids.
  var rps = [];
  eles.procs.find('div.proc').each(function(){
    rps.push(parseInt(this.id.substr(5)));
  });
  // Processes that waiting to be created.
  var cps = procs.data;
  // Processes that should be deleted.
  var dps = _.difference(rps, cps.map(function(p){
    return p.pm_id;
  }));
  // Processes that should be updated.
  var ups = [];

  // Remove the processes to be deleted.
  rps = _.difference(rps, dps);

  if (rps.length > 0) {
    // Remove existing.
    cps = cps.filter(function(p){
      return !~rps.indexOf(p.pm_id);
    });

    // Compare with previous processes to grep `ups`.
    if (prevProcs) {
      rps.forEach(function(pm_id){
        var proc1 = _.find(prevProcs.data, function(p){
              return p.pm_id == pm_id;
            }),
            proc2 = _.find(procs.data, function(p){
              return p.pm_id == pm_id;
            });

        if (proc1 && proc2 &&
          (proc1.pm2_env.status != proc2.pm2_env.status ||
          proc1.pm2_env.pm_uptime != proc2.pm2_env.pm_uptime ||
          proc1.pm2_env.restart_time != proc2.pm2_env.restart_time)) {
          ups.push(proc2);
        }
      });
    }
  }

  var animated = false;
  // Create.
  if (cps.length > 0) {
    animated = true;
    createProcs(cps, noprocRendered, noAnimation);
  }
  // Delete
  if (dps.length > 0) {
    removeProcs(dps, animated || noAnimation);
    animated = true;
  }
  // Update
  if (ups.length > 0) {
    updateProcs(ups, animated || noAnimation);
  }
  cloneProcs();
}

/**
 * Create processes' layout.
 * @param {Array} _procs
 * @param {Boolean} noproc `empty tip` is rendered before.
 * @param {Boolean} noAnimation
 */
function createProcs(_procs, noproc, noAnimation){
  var html = '';
  _procs.forEach(function(p){
    html += tmps.proc({proc: p, noDiv: false});
  });

  // Attach events of process.
  attachProcEvents($(html).appendTo(eles.procs));

  // Flip in if necessary.
  !noAnimation && flipProcs();

  // Remove `empty tip` if necessary.
  noproc && eles.procs.find('.proc-empty').remove();

  // slimScroll if processes length is greater than 10.
  if (eles.procs.find('div.proc').length > 10) {
    if (eles.procs.data('slimScroll')) {
      return;
    }
    eles.procs.data('slimScroll', true);
    eles.procs.slimScroll({
      height     : '600px',
      width      : '720px',
      color      : '#fff',
      opacity    : 0.8,
      railVisible: true,
      railColor  : '#fff'
    });
  } else {
    destroySlimScroll();
  }
}

/**
 * Update processes' layout.
 * @param {Array} _procs
 * @param {Boolean} noAnimation
 */
function updateProcs(_procs, noAnimation){
  // Find elements and replace them new ones.
  eles.procs.find(_procs.map(function(p){
    return '#proc_' + p.pm_id;
  }).join(',')).each(function(){
    var _id = parseInt(this.id.substr(5)),
        proc = _.find(_procs, function(p){
          return p.pm_id == _id;
        });

    // HTML
    var procHTML = tmps.proc({proc: proc, noDiv: true});

    var ele = $(this);
    // Animate it or not.
    if (!noAnimation) {
      animate(ele, 'flipOutX', function(){
        var newProc = $(procHTML);
        ele.replaceWith(newProc);
        animate(newProc, 'flipInX', startTimer);
        attachProcEvents(newProc);
      });
    } else {
      ele.replaceWith(procHTML);
    }
  });
}

/**
 * Remove processes from layout.
 * @param {Array} pm_ids pm_ids of processes.
 * @param {Boolean} noAnimation
 */
function removeProcs(pm_ids, noAnimation){
  // Find elements and remove them directly.
  eles.procs.find(pm_ids.map(function(id){
    return '#proc_' + id;
  }).join(',')).each(function(){
    var ele = $(this);
    ele.next().remove();
    ele.remove();
  });

  // Flip it if necessary.
  !noAnimation && flipProcs();

  // Destroy slimScroll if necessary.
  if (eles.procs.find('div.proc').length <= 10) {
    destroySlimScroll();
  }
}

/**
 * Clone processes and count uptime from now.
 */
function cloneProcs(){
  // Clone processes.
  prevProcs = _.clone(procs);

  // Timer of uptime.
  startTimer();
}

/**
 * Timer of uptime.
 */
function startTimer(){
  timer && clearTimeout(timer);
  updateUptime();
}

/**
 * Update the uptimes of processes.
 */
function updateUptime(){
  var spans = eles.procs.find('span[data-ctime][data-running=YES]');
  if (spans.length == 0) {
    return;
  }
  var now = Date.now();
  spans.each(function(){
    var ele = $(this);
    ele.text(fromNow(Math.ceil((now - ele.data('ctime')) / 1000), true));
  });

  // Only do this job on fullPage 2.
  (pageIndex == 2) && (timer = setTimeout(updateUptime, 1000));
}

/**
 * Flip processes' layout.
 */
function flipProcs(){
  var p = eles.procs.parent();
  animate(p.hasClass('slimScrollDiv') ? p : eles.procs, 'flip');
}

/**
 * Destroy slimScroll of processes' layout.
 */
function destroySlimScroll(){
  if (!eles.procs.data('slimScroll')) {
    return;
  }
  eles.procs.slimScroll({
    destroy: true
  });
  eles.procs.data('slimScroll', false).css('height', 'auto');
}

/**
 * Bind process events.
 * @param {jQuery} o
 */
function procEvents(o){
  o.find('.proc-ops').on('click', 'i', function(){
    var ele = $(this),
        method = ele.data('original-title').toLowerCase(),
        pm_id = parseInt(ele.closest('.proc').attr('id').substr(5));

    var ops = ele.closest('.proc-ops');
    $('<div class="load"></div>').css({opacity: 0.01}).appendTo(ops);

    ops.find('ul').fadeOut().next().animate({opacity: 1});

    sockets.sys.emit('action', method, pm_id);
  }).end().find('[data-toggle="tooltip"]').tooltip({container: 'body'});
}

/* SG Changes Begin */
function removeActions(o){
  o.find('.proc-ops').remove();
}
/* SG Changes End */

/**
 * Attach events to process layout.
 * @param {jQuery} o
 */
function attachProcEvents(o){
  bindPopup(o);
  /* SG Changes Begin
  procEvents(o);
   */
  if (manipulation) {
    procEvents(o);
  } else {
    removeActions(o);
  }
  /* SG Changes End */
}

/**
 * Popup dialog to display full information of processes.
 * @param {jQuery} o
 */
function bindPopup(o){
  o.find('.proc-name').avgrund({
    width          : 640,
    height         : 350,
    showClose      : true,
    holderClass    : 'proc-popup',
    showCloseText  : 'CLOSE',
    onBlurContainer: '.section',
    onLoad         : function(ele){
      popupShown = true;
      setFPEnable(false, false);
      showPopupTab(getProcByEle(ele));
    },
    onUnload       : function(ele){
      scrolled = false;
      popupShown = false;
      setFPEnable(true, false);
      destroyTail();
      destroyMonitor();
      popupProc = null;
    },
    template       : '<div id="popup"><div class="load"></div></div>'
  });
}

/**
 * Reset tabcontent of popup.
 * @param {Object} proc
 * @returns {*}
 */
function showPopupTab(proc, delayed){
  if (!proc) {
    return info('Process does not exist, try to refresh current page manually (F5 or COMMAND+R)');
  }
  // Do this after popup is shown.
  if (!delayed) {
    return setTimeout(showPopupTab, 800, proc, true);
  }

  // Resort keys.
  var clonedProc = {};
  Object.keys(proc).sort(function(a, b){
    return a.charCodeAt(0) - b.charCodeAt(0);
  }).forEach(function(key){
    // Omit memory, just keep the original data.
    if (key == 'monit') {
      var monit = proc[key];
      monit.memory = getMem(monit.memory);
      return clonedProc[key] = monit;
    }
    clonedProc[key] = proc[key];
  });

  // Reset content HTML.
  var popup = $('#popup').html(tmps.popup({info: highlight(clonedProc)}));
  // Find tabcontent.
  var tabContent = popup.find('.tab-content').eq(0);
  // Bind slimScroll.
  tabContent.slimScroll({
    height     : '300px',
    color      : '#000',
    opacity    : 0.8,
    railVisible: true,
    railColor  : '#f0f0f0'
  });

  // Bing tab change event.
  popup.find('li').click(function(){
    var ele = $(this);
    if (ele.hasClass('active')) {
      return;
    }

    // Scroll to y: 0
    tabContent.slimScroll({
      scrollTo: 0
    });

    var tab = $(this).text().trim();

    if (tab != 'Log') {
      destroyTail();
      $('#log').html('<div class="load"></div>');
      scrolled = false;
      popupProc = null;
    }

    if (tab != 'Monitor') {
      destroyMonitor();
      $('#monitor').html('<div class="load"></div>');
      popupProc = null;
    }

    // Tail logs.
    if (tab == 'Log') {
      popupProc = proc;
      return tailLogs();
    }
    if (tab == 'Monitor') {
      popupProc = proc;
      return monitorProc();
    }
  })
}

/**
 * Tail log of process
 * @returns {*}
 */
function tailLogs(){
  if (!popupProc) {
    $('#log').html('<span style="color:#ff0000">Process does not exist.</span>')
    return;
  }
  if (!sockets.log) {
    sockets.log = io('/log', {path: url_prefix + "/socket.io"}); //SG Changed
    sockets.log.on('log', appendLogs);
    sockets.log.on('connect', function(){
      sockets.log.emit('tail', popupProc.pm_id);
    });
  } else {
    sockets.log.connect();
  }
}

/**
 * Append logs to DOM.
 * @param {Object} log
 */
function appendLogs(log){
  // Check process and pm_id should be equalled.
  if (!popupProc || popupProc.pm_id != log.pm_id) {
    return;
  }

  // Remove `loading` status.
  $('#log>.load').remove();

  var lo = $('#log');
  $(log.msg).appendTo(lo);

  var offset = lo.get(0).scrollHeight - 300,
      poffset = lo.parent().scrollTop() || 0;
  // Scroll down if necessary.
  if (!scrolled || poffset >= offset - 30) {
    !scrolled && (scrolled = poffset < offset - 30)
    lo.parent().slimScroll({
      scrollTo: offset
    });
  }
}

/**
 * Destroy tail socket.
 */
function destroyTail(){
  if (!sockets.log) {
    return;
  }
  sockets.log.disconnect();
}

/**
 * Monitor the memory && CPU usage of process.
 */
function monitorProc(){
  if (!popupProc || popupProc.pid == 0) {
    $('#monitor').html('<span style="color:#ff0000">Process does not exist or is not running.</span>')
    return;
  }
  if (!sockets.proc) {
    sockets.proc = io('/proc', {path: url_prefix + "/socket.io"}); //SG Changed
    sockets.proc.on('proc', appendData);
    sockets.proc.on('connect', function(){
      sockets.proc.emit('proc', popupProc.pid);
    });
  } else {
    sockets.proc.connect();
  }
}

/**
 * Append data to lineChart.
 * @param proc
 */
function appendData(proc){
  if (!popupProc || popupProc.pid != proc.pid) {
    return;
  }
  var loadEl = $('#monitor>.load');
  if (lineChart.data.length == 0) {
    var now = proc.time,
        len = lineChart.settings.queueLength;

    lineChart.data = d3.range(len).map(function(n){
      return {time: now - (len - n) * 3000, usage: {cpu: 0, memory: 0}};
    });
  }
  lineChart.data.push(proc);
  if (loadEl.length > 0) {
    loadEl.remove();
    lineChart.next();
  }
}

/**
 * Destroy monitor socket.
 */
function destroyMonitor(){
  if (!sockets.proc) {
    return;
  }
  sockets.proc.disconnect();
  lineChart.destroy();
}

/**
 * Get process by Uid span element.
 * @param {jQuery} ele
 * @returns {*}
 */
function getProcByEle(ele){
  var id = parseInt(ele.data('pmid'));
  return _.find(procs.data, function(p){
    return p.pm_id == id;
  });
}

/**
 * Animate element with animation from animate.css
 * @param {jQuery} o element
 * @param {String} a animation name
 * @param {Function} cb callback
 */
function animate(o, a, cb){
  a += ' animated';
  o.removeClass(a).addClass(a).one('webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend animationend', function(){
    var ele = $(this);
    ele.removeClass(a)
    cb && cb.call(ele);
  });
}

/**
 * Show sticky information
 * @param {String} msg
 */
function info(msg){
  $.sticky({
    body         : msg,
    icon         : './img/info.png',
    useAnimateCss: true
  });
}

/**
 * Wrap memory.
 * @param {Float} mem
 * @returns {string}
 */
function getMem(mem){
  if (typeof mem == 'string') {
    return mem;
  }

  if (mem < 1024) {
    return mem + 'B';
  }
  if (mem < 1048576) {
    return Math.round(mem / 1024) + 'K';
  }
  if (mem < 1073741824) {
    return Math.round(mem / 1048576) + 'M';
  }
  return Math.round(mem / 1073741824) + 'G';
}

/**
 * Wrap tick from now.
 * @param {Float} tick
 * @param {Boolean} tiny show all of it.
 * @returns {string}
 */
function fromNow(tick, tiny){
  if (tick < 60) {
    return tick + 's';
  }
  var s = tick % 60 + 's';
  if (tick < 3600) {
    return parseInt(tick / 60) + 'm ' + s;
  }
  var m = parseInt((tick % 3600) / 60) + 'm ';
  if (tick < 86400) {
    return parseInt(tick / 3600) + 'h ' + m + (!tiny ? '' : s);
  }
  var h = parseInt((tick % 86400) / 3600) + 'h ';
  return parseInt(tick / 86400) + 'd ' + h + (!tiny ? '' : m + s);
}

/**
 * Hightlight JSON
 * @param {JSON} data
 * @param {Int} indent
 * @returns {string}
 */
function highlight(data, indent){
  indent = indent || 2;

  data = JSON.stringify(typeof data != 'string' ? data : JSON.parse(data), undefined, indent);

  [[/&/g, '&amp;'], [/</g, '&lt;'], [/>/g, '&gt;']].forEach(function(rep){
    data = String.prototype.replace.apply(data, rep);
  });

  return data.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function(m){
    var color = '1e297e';
    if (/^"/.test(m)) {
      color = ['440a4d', '0d660a'][/:$/.test(m) ? 0 : 1];
    } else if (/true|false/.test(m)) {
      color = '1e297e';
    } else if (/null|undefined/.test(m)) {
      color = '14193c';
    }
    return '<span style="color: #' + color + '">' + m + '</span>';
  }).replace(/\n/, '<br />');
};

/**
 * Line chart represents memory / CPU usage.
 */
var lineChart = {
  settings: {
    id             : '#monitor',
    width          : 580,
    height         : 270,
    ticks          : 5,
    tension        : 0.8,
    padding        : 10,
    queueLength    : 20,
    transitionDelay: 3000,
    fancyDelay     : 1000,
    tickFormat     : '%H:%M:%S',
    series         : ['cpu', 'memory'],
    colors         : {
      line: {cpu: 'rgba(0, 200, 0, 1)', memory: 'rgba(200, 200, 0, 1)'},
      dot : '#ff5400'
    }
  },
  data    : [],
  eles    : {},
  destroy : function(){
    this.eles.path && this.eles.path.interrupt().transition();
    this.eles.xAxis && this.eles.xAxis.interrupt().transition();
    d3.timer.flush();
    this.data = [];
    this.eles = {};
  },
  next    : function(forceQuit){
    var ng = !this.eles.svg;
    if (ng && forceQuit) {
      return;
    }

    if (ng) {
      this._graph();
    }
    var st = this.settings;

    if (this.data.length < st.queueLength) {
      return;
    }

    this.eles.path.attr('transform', 'translate(0, ' + st.padding + ')');
    this.eles.xAxis.call(this.eles.x.axis);

    this.eles.x.domain([this.data[1].time, this.data[st.queueLength - 1].time]);

    st.series.forEach(function(key){
      lineChart.eles[key + 'LineEl']
        .attr('d', lineChart.eles[key + 'Line'])
        .attr('transform', null);
    });

    if (ng) {
      return setTimeout(function(ctx){
        ctx.next(true);
      }, 10, this);
    }

    this.eles.path
      .transition()
      .duration(st.transitionDelay)
      .ease('linear')
      .attr('transform', 'translate(' + this.eles.x(this.data[0].time) + ', ' + st.padding + ')')
      .each('end', function(){
        lineChart.next(true);
      });

    this.eles.xAxis.transition()
      .duration(st.transitionDelay)
      .ease('basic')
      .call(this.eles.x.axis);

    this.data.shift();
  },
  _graph  : function(){
    var st = this.settings;
    st.gWidth = st.width;
    st.gHeight = st.height - 50;

    var series = '<ul>';
    st.series.forEach(function(key){
      series += '<li style="color:' + st.colors.line[key] + '">' + key + '</li>';
    });
    series += '</ul>';

    $(series).appendTo(st.id);

    this.eles.x = d3.time
      .scale()
      .range([0, st.gWidth]);

    this.eles.x.axis = d3.svg.axis()
      .scale(this.eles.x)
      .tickFormat(d3.time.format(st.tickFormat))
      .ticks(st.ticks)
      .orient('bottom');

    this.eles.y = d3.scale
      .linear()
      .domain([0, 100])
      .range([st.gHeight, 0])
      .clamp(true);

    this.eles.y.axis = d3.svg
      .axis()
      .scale(this.eles.y)
      .orient('right')
      .ticks(st.ticks);

    this.eles.svg = d3
      .select(lineChart.settings.id)
      .append('svg')
      .attr('width', st.width)
      .attr('height', st.height);

    this.eles.svg.append('defs').append('clipPath')
      .attr('id', 'clip')
      .append('rect')
      .attr('width', st.gWidth)
      .attr('height', st.height);

    this.eles.g = this.eles.svg
      .append('g')
      .attr('clip-path', 'url(#clip)')
      .selectAll('g')
      .data([this.data])
      .enter()
      .append('g')
      .attr('transform', 'translate(0, 0)');

    this.eles.path = this.eles.g.append('g')
      .attr('transform', 'translate(0, ' + st.padding + ')');

    st.series.forEach(function(key){
      lineChart.eles[key + 'Line'] = d3.svg
        .line()
        .interpolate('cardinal')
        .tension(st.tension)
        .x(function(d){
          return lineChart.eles.x(d.time);
        })
        .y(function(d){
          return lineChart.eles.y(d.usage[key]);
        });

      lineChart.eles[key + 'LineEl'] = lineChart.eles.path.append('path')
        .attr('class', 'line')
        .style('stroke', st.colors.line[key])
        .attr('d', lineChart.eles[key + 'Line']);
    });

    this.eles.g.append('g')
      .attr('class', 'y axis')
      .attr('transform', 'translate(1, ' + st.padding + ')')
      .call(this.eles.y.axis);

    this.eles.xAxis = this.eles.g.append('g')
      .attr('class', 'x axis')
      .attr('transform', 'translate(0,' + (st.gHeight + st.padding) + ')')
      .call(this.eles.x.axis);
  }
};
