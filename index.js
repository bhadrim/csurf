/*!
 * csurf
 * Copyright(c) 2011 Sencha Inc.
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2014-2016 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict'

/**
 * Module dependencies.
 * @private
 */

var Cookie = require('cookie')
var createError = require('http-errors')
var sign = require('cookie-signature').sign
var Tokens = require('csrf')

/**
 * Module exports.
 * @public
 */

module.exports = csurf

/**
 * CSRF protection middleware.
 *
 * This middleware adds a `req.csrfToken()` function to make a token
 * which should be added to requests which mutate
 * state, within a hidden form field, query-string etc. This
 * token is validated against the visitor's session.
 *
 * @param {Object} options
 * @return {Function} middleware
 * @public
 */

function csurf (options) {
  var opts = options || {}

  // get cookie options
  var cookie = getCookieOptions(opts.cookie)

  // get session options
  var sessionKey = opts.sessionKey || 'session'

  // get value getter
  var value = opts.value || defaultValue

  // token repo
  var tokens = new Tokens(opts)

  // ignored methods
  var ignoreMethods = opts.ignoreMethods === undefined
    ? ['GET', 'HEAD', 'OPTIONS']
    : opts.ignoreMethods

  if (!Array.isArray(ignoreMethods)) {
    throw new TypeError('option ignoreMethods must be an array')
  }

  // generate lookup
  var ignoreMethod = getIgnoredMethods(ignoreMethods)

  return function csrf (req, res, next) {
    var url = req.protocol + '://' + req.get('host') + req.originalUrl;
    console.log('Enter function csrf - request: %s', url);
    // validate the configuration against request
    if (!verifyConfiguration(req, sessionKey, cookie)) {
      return next(new Error('misconfigured csrf'))
    }

    // get the secret from the request
    var secret = getSecret(req, sessionKey, cookie)
    console.log('csrf - secret %s', secret);
    
    var token

    // lazy-load token getter
    req.csrfToken = function csrfToken () {
      var sec = !cookie
        ? getSecret(req, sessionKey, cookie)
        : secret
        console.log('csrfToken - sec %s', sec);
      // use cached token if secret has not changed
      if (token && sec === secret) {
        console.log('csrfToken - return existing token %s', token);
        return token
      }

      // generate & set new secret
      if (sec === undefined) {
        console.log('csrfToken - undefined seed sed');
        sec = tokens.secretSync()
        setSecret(req, res, sessionKey, sec, cookie)
      }

      // update changed secret
      secret = sec
      console.log('csrfToken - secret %s', secret);
      // create new token
      token = tokens.create(secret)
      console.log('Exit csrfToken - return new token %s', token);
      return token
    }

    // generate & set secret
    if (!secret) {
      secret = tokens.secretSync()
      setSecret(req, res, sessionKey, secret, cookie)
      console.log('csrf - secret %s', secret);
    }

    // verify the incoming token
    if (!ignoreMethod[req.method] && !tokens.verify(secret, value(req))) {
      console.log('Exit function csrf request url with EBADCSRFTOKEN %s', url);
      return next(createError(403, 'invalid csrf token', {
        code: 'EBADCSRFTOKEN'
      }))
    }
    console.log('Exit function csrf request url %s', url);
    next()
  }
}

/**
 * Default value function, checking the `req.body`
 * and `req.query` for the CSRF token.
 *
 * @param {IncomingMessage} req
 * @return {String}
 * @api private
 */

function defaultValue (req) {
  return (req.body && req.body._csrf) ||
    (req.query && req.query._csrf) ||
    (req.headers['csrf-token']) ||
    (req.headers['xsrf-token']) ||
    (req.headers['x-csrf-token']) ||
    (req.headers['x-xsrf-token'])
}

/**
 * Get options for cookie.
 *
 * @param {boolean|object} [options]
 * @returns {object}
 * @api private
 */

function getCookieOptions (options) {
  if (options !== true && typeof options !== 'object') {
    return undefined
  }

  var opts = Object.create(null)

  // defaults
  opts.key = '_csrf'
  opts.path = '/'

  if (options && typeof options === 'object') {
    for (var prop in options) {
      var val = options[prop]

      if (val !== undefined) {
        opts[prop] = val
      }
    }
  }

  return opts
}

/**
 * Get a lookup of ignored methods.
 *
 * @param {array} methods
 * @returns {object}
 * @api private
 */

function getIgnoredMethods (methods) {
  var obj = Object.create(null)

  for (var i = 0; i < methods.length; i++) {
    var method = methods[i].toUpperCase()
    obj[method] = true
  }

  return obj
}

/**
 * Get the token secret from the request.
 *
 * @param {IncomingMessage} req
 * @param {String} sessionKey
 * @param {Object} [cookie]
 * @api private
 */

function getSecret (req, sessionKey, cookie) {
  // get the bag & key
  var bag = getSecretBag(req, sessionKey, cookie)
  var key = cookie ? cookie.key : 'csrfSecret'
  console.log('getSecret secret key: %s', key);
  if (!bag) {
    throw new Error('misconfigured csrf')
  }

  // return secret from bag
  return bag[key]
}

/**
 * Get the token secret bag from the request.
 *
 * @param {IncomingMessage} req
 * @param {String} sessionKey
 * @param {Object} [cookie]
 * @api private
 */

function getSecretBag (req, sessionKey, cookie) {
  if (cookie) {
    // get secret from cookie
    var cookieKey = cookie.signed
      ? 'signedCookies'
      : 'cookies'

    return req[cookieKey]
  } else {
    // get secret from session
    return req[sessionKey]
  }
}

/**
 * Set a cookie on the HTTP response.
 *
 * @param {OutgoingMessage} res
 * @param {string} name
 * @param {string} val
 * @param {Object} [options]
 * @api private
 */

function setCookie (res, name, val, options) {
  var data = Cookie.serialize(name, val, options)

  var prev = res.getHeader('set-cookie') || []
  var header = Array.isArray(prev) ? prev.concat(data)
    : [prev, data]

  res.setHeader('set-cookie', header)
}

/**
 * Set the token secret on the request.
 *
 * @param {IncomingMessage} req
 * @param {OutgoingMessage} res
 * @param {string} sessionKey
 * @param {string} val
 * @param {Object} [cookie]
 * @api private
 */

function setSecret (req, res, sessionKey, val, cookie) {
  if (cookie) {
    // set secret on cookie
    var value = val

    if (cookie.signed) {
      value = 's:' + sign(val, req.secret)
    }

    setCookie(res, cookie.key, value, cookie)
  } else {
    // set secret on session
    req[sessionKey].csrfSecret = val
  }
}

/**
 * Verify the configuration against the request.
 * @private
 */

function verifyConfiguration (req, sessionKey, cookie) {
  if (!getSecretBag(req, sessionKey, cookie)) {
    return false
  }

  if (cookie && cookie.signed && !req.secret) {
    return false
  }

  return true
}
