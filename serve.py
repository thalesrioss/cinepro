import http.server, os
os.chdir('/Users/thalesrioss/Documents/Claude/CinePRO')
handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(('', 7890), handler)
httpd.serve_forever()
