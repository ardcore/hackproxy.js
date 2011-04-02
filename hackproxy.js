(function(global) {

	var http = require('http'),
		url = require('url'),
		fs = require('fs'),
		request = require('request'),
		port = 8080,
		cacheDir = "stored/";

	var contentTypes = {
		'html': 'text/html',
		'css': 'text/css',
		'js': 'text/javascript',
		'jpg': 'image/jpeg',
		'png': 'image/png',
		'gif': 'image/gif',
		'swf': 'application/x-shockwave-flash'
	};

	// check params, display help, assign port (default: 8080)
	var param = process.argv[2];
	if (param == "help" || param == "--help" || param == "-h") {
		console.log("Usage: hackproxy.js [port]");
		process.exit();
	} else if (parseInt(param,10) == param) {
		port = param;
	} else if (param) {
		console.log("Incorrect parameter: " + param);
		process.exit();
	}

	var server = http.createServer(function(req, res) {

		var parsedUrl = url.parse(req.url, true),
			path = parsedUrl.pathname,
			query = parsedUrl.query;

		// if it's a request from a main page
		if (path.match(/\/$/)) {

			// request for a webpage?
			if (query && query.url) {
				if (!query.url.match(/^http/)) query.url = "http://" + query.url;
				var target = url.parse(query.url);
				createDirStruct(target.host + target.pathname, makeRequest);
				function makeRequest() {
					request({uri:query.url}, function (error, response, body) {
						if (!error && response.statusCode == 200) {
							res.writeHead(200, {'Content-Type': response['content-type']});
							// modify source adding "proxy" (127.0.0.1)
							res.write(addProxyStrings(body, query.url), 'utf8');
							res.end();
						}
					})
				}

			// request for proxied content?
			} else if (query && query.proxy) {
				serveProxiedContent(query.proxy, query.domain, function(content) {
					if (content && content.data && content.type) {
						res.writeHead(200, {'Content-Type': content.type});
						res.write(content.data, content.type.match(/image/) ?
							"binary" : encoding = 'utf8');
						res.end();
					} else send404(res, query.proxy);
				});

			// otherwise we're serving main page
			} else {
				fs.readFile(__dirname + "/index.html", function(err, data) {
					res.writeHead(200, {'Content-Type': 'text/html'});
					res.write(data, 'utf8');
					res.end();
				});
			}

		// request not for a main page: serve what you can
		} else {
			var contentType = findContentType(path);
			if (contentType) {
				fs.readFile(__dirname + path, function(err, data) {
					if (err) return send404(res, __dirname + path);
					res.writeHead(200, {'Content-Type': contentType });
					res.write(data, 'utf8');
					res.end();
				});
			} else send404(res, path);

		}
	});

	function findContentType(txt) {
		return contentTypes[txt.match(/([a-zA-Z])*(\?|$)/)[0]] || "";
	}

	function send404(res, path) {
		console.log("404 ERROR: " + path);
		res.writeHead(404, {'Content-Type': 'text/html' });
		res.write("<html><body>404</body></html>", 'utf8');
		res.end();
	}

	function addProxyStrings(txt, domain) {
		txt = txt.replace(/src=\"/g, "src=\"http://127.0.0.1:8080/?domain=" + domain + "&proxy=");
		txt = txt.replace(/href=\"/g, "href=\"http://127.0.0.1:8080/?domain=" + domain + "&proxy=");
		return txt;
	}

	function removeProxyStrings(txt) {
		txt = txt.replace(/src=\"(.*)proxy=/, "", "g");
		txt = txt.replace(/href=\"(.*)proxy=/, "", "g");
		return txt;
	}

	function serveProxiedContent(urlString, domainString, callback) {

		// urlString may be:
		// 1. normal: http(s)://foo.com/bar.html
		// 2. indirect: http://foo.com/bar/
		// 3. indirect without trailing slash: http://foo.com/bar
		// 4. relative: /bar.html
		// 5. relative without leading slash: bar.html
		// 4. may include query: bar.html?123

		// separate query part, if present
		urlString = urlString.split("?")[0];

		// build objects from parsed url and domain strings
		var target = url.parse(urlString);
		var domain = url.parse(domainString);

		// build string to be used as a directory struct bundle
		var targetDirStructure = (target.host || domain.host +
			(domain.pathname || "") ) + "/" + target.pathname;

		// build path to a cached file which we'll try to read
		var fullPath = __dirname + "/" + cacheDir + targetDirStructure;

		// build url which we'll request and store if the cached file is not found
		var targetUrl = removeProxyStrings(urlString);

		// if it's not absolute request, make it absolute
		if (!targetUrl.match(/^http/)) {
			targetUrl = domain.protocol + "//" + targetDirStructure;
		}

		var ret = { data: null, type: null, file: null };

		fs.readFile(fullPath, function(err, data) {

			// if we can't read the file, probably we don't have it yet
			if (err || !data) {
				ret.type = findContentType(targetUrl);
				request({uri:targetUrl, encoding:ret.type.match(/image/) ?
					"binary" : 'utf8'}, function (error, response, body) {
					// make directories and write the file
					if (!error && response.statusCode == 200) {
						ret.data = body;
						ret.file = urlString;
						createDirStruct(cacheDir + targetDirStructure, createFile);

						function createFile() {
							fs.writeFile(fullPath, body, ret.type.match(/image/) ?
								"binary" : 'utf8', function(err) {
								if (err) console.log("error writing: " + fullPath)
								callback.call(null, ret);
							});
						}
					} else {
						console.log("request error", targetUrl);
						callback.call(null, ret);
					}
				});
			// if there's a file, use it
			} else {
				ret.data = data;
				ret.type = findContentType(urlString);
				ret.file = urlString;
				callback.call(null, ret);
			}
		});
	}

	/* async creation of directory structore based on a string:
	   "www.foo.com/bar/baz/" ->
	    www.foo.com     (dir)
	     \_bar          (dir)
	        \_baz       (dir)
	*/

	function createDirStruct(bundle, callback) {
		var dirlist = bundle.split("/"),
			i = 0,
			max = dirlist.length - 1,
			preceed = "";

		function createDirStep(path, i, callback) {
			if (i >= max) {
				return callback.call();
			}
			fs.stat(path + dirlist[i], function(err, stat) {
				if (err || !stat) {
					fs.mkdir(path + dirlist[i], 0777, function(err) {
						if (err) {
							console.log("couldn't make dir " + dirlist[i]);
						}
						path = path + dirlist[i] + "/";
						i++;
						createDirStep.call(null, path, i, callback);
					});
				} else {
					path = path + dirlist[i] + "/";
					i++;
					createDirStep.call(null, path, i, callback);
				}
			});
		}

		createDirStep(preceed, i, callback);
	}

	server.listen(port);
	console.log("hackproxy listening on 127.0.0.1:" + port);

}(this));
