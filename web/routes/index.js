var Monitor = require('../../lib/mon'),
    crypto  = require('crypto');

// Authorize
action(function auth(req, res){
  var authCode = req.session['auth_code'],
      storedCode = Monitor().config('password');

  if (!storedCode || (storedCode == authCode)) {
    return res.redirect('/');
  }
  res.render('auth', {title: 'Authorize'});
});

// Index
action(function(req, res){
  var authCode = req.session['auth_code'],
      storedCode = Monitor().config('password');
  if (storedCode && storedCode != authCode) {
    return res.redirect('/auth');
  }
  /* SG Changes Begin
  res.render('index', {title: 'Monitor'});
   */
  var url_prefix = '/pm2_proxy/' + (process.env.HOSTNAME || 'localhost');
  res.render('index', {
      title: 'Monitor',
      manipulation: Monitor().config('manipulation'),
      url_prefix: url_prefix
  });
  /* SG Changes End */
});

// API
action(function auth_api(req, res){
  if (!req.query || !req.query.pwd) {
    return res.json({error: 'Authorize failed, password is required!'});
  }

  var mon = Monitor(),
      md5 = crypto.createHash('md5');
  md5.update(req.query.pwd);
  encryptedPwd = md5.digest('hex');
  if (encryptedPwd == mon.config('password')) {
    req.session['auth_code'] = encryptedPwd;
    return res.json({status: 200});
  }
  return res.json({error: 'Authorize failed, password is not correct.'});
});
