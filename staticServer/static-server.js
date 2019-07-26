const http = require('http')
const path = require('path')
const url = require('url')
const config = require('./config/default')
const fs = require('fs')
const zlib = require('zlib')
const mime = require('./mime')

//判读url末尾是否有’/‘
const hasTrailingSlash = url => url[url.length -1] === '/'

//定义StaticServer类
class StaticServer {
    //构造函数
    constructor() {
        this.port = config.port
        this.root = config.root
        this.indexPage = config.indexPage
        this.enableCacheControl = config.cacheControl
        this.enableExpires = config.expires
        this.enableEtag = config.etag
        this.enableLastModified = config.lastModified
        this.maxAge = config.maxAge
        this.zipMatch = new RegExp(config.zipMatch)
    }

    //500错误
    respondError(err, res) {
        res.writeHead(500)
        return res.end(err)
    }

    //返回404页面
    responseNotFound(req, res) {
        res.writeHead(404, {
            'Content-Type': 'text/html'
        })
        res.end(`<h1>Not Found</h1><p>The request URL ${req.url} was not found on this server.</p>`)
    }

    //设置缓存相关的响应头部 etag
    generateEtag(stat) {
        //stat/mtime获取lastModified时间 getTime()返回一个格林威治时间
        let mtime = stat.mtime.getTime().toString(16)
        let size = stat.size.toString(16)
        //自己设置etag的值
        return `W/"${size}-${mtime}"`
    }

    setFreshHeaders(stat, res) {
        //stat.mtime日期是IOS 8901格式  last-modified和if-modified-since是UTC格式的日期
        let lastModified = stat.mtime.toUTCString()
        if (this.enableExpires) {
            let expireTime = (new Date(Date.now() + this.maxAge * 1000)).toUTCString()
            res.setHeader('Expires', expireTime)
        }
        if (this.enableCacheControl) {
            res.setHeader('Cache-Control', `public, max-age=${this.maxAge}`)
        }
        if (this.enableLastModified) {
            res.setHeader('Last-Modified', lastModified)
        }
        if (this.enableEtag) {
            res.setHeader('ETag', this.generateEtag(stat))
        }

    }

    //弱缓存是否有效
    isFresh(reqHeaders, resHeaders) {
        let noneMatch = reqHeaders['if-none-match']
        let lastModified = reqHeaders['if-modified-since']
        //请求报文中没有if-none-match或if-modified-since
        if (!(noneMatch || lastModified)) return false
        //etag 失效
        if (noneMatch && (noneMatch !== resHeaders['etag'])) return false
        //last-modified失效
        if (lastModified && (lastModified !== resHeaders['last-modified']))  return false
        //内容没改动
        return true
    }

    //判断是否需要压缩
    shouldCompress(pathName) {
        //字符串方法match()
        return path.extname(pathName).match(this.zipMatch)
    }

    //判断返回200还是304
    respond(pathName, req, res) {
        fs.stat(pathName, (err, stat) => {
            if (err) return this.respondError(err, res)
            this.setFreshHeaders(stat, res)
            //前面调用了res.setHeader()才能通过res._headers访问header内容
            if (this.isFresh(req.headers, res._headers)) {
                //返回304
                this.respondNotModified(res)
            } else {
                //返回200
                this.responseFile(pathName, req, res)
            }
        })
    }

    respondNotModified(res) {
        res.statusCode = 304
        res.end()
    }

    //处理压缩 
    compressHandler(readStream, req, res) {
        let acceptEncoding = req.headers['accept-encoding']
        //不支持压缩
        if (!acceptEncoding || !acceptEncoding.match(/\b(gzip|deflate)\b/)) {
            return readStream
        }else if (acceptEncoding.match(/\bgzip\b/)) {
            res.setHeader('Content-Encoding', 'gzip')
            return readStream.pipe(zlib.createGzip())
        } else if (acceptEncoding.match(/\bdeflate\b/)){
            res.setHeader('Content-Encoding','deflate')
            return readStream.pipe(zlib.createDeflate())
        }
    }

    //用stream的形式读取内容
    responseFile(pathName, req, res) {
        let readStream = fs.createReadStream(pathName)
        res.setHeader('Content-Type', mime.getExtname(pathName))
        if (this.shouldCompress(pathName)) {
            readStream = this.compressHandler(readStream, req, res)
        }
        readStream.pipe(res)
    }

    //重定向函数
    respondRedirect(req, res) {
        let location = req.url + '/'
        res.writeHead(301, {
            'Location': location,
            'Content-Type': 'text/html'
        })
        res.end(`Redirecting to <a href='${location}'>${location}</a>`)
    }

    //目录存在，有默认的index.html页返回默认页，没有的话返回目录下内容列表
    respondDirectory(pathName, req, res) {
        let indexPagePath = path.join(pathName, this.indexPage)
        //fs.exists(path, callback) 检测给定的文件路径是否存在 ，传true或false
        if (fs.existsSync(indexPagePath)) {
            this.respond(indexPagePath, req, res)
        }else {
            //不存在index.html文件
            //fs.readdir(path, callback)异步读取目录   callback参数:err,files->目录下的文件数组列表
            fs.readdir(pathName, (err, files) => {
                if (err) {
                   // res.writeHead(500)
                   //  return res.end(err)
                    this.respondError(err, res)
                }
                //url.parse()此函数接受一个URL 字符串并返回一个对象。如果第二个参数传递true，node 会使用querystring 模块解析查询 字符串。
                //pathname 紧跟主机地址之后，查询参数之前的部分，包括开头的/
                let requestPath = url.parse(req.url).pathname
                let content = `<h1>Index Of ${requestPath}</h1>`
                //files是目录下的文件列表
                files.forEach(file => {
                    let itemLink = path.join(requestPath, file)
                    //同步获取文件信息
                    let stat = fs.statSync(path.join(pathName, file))
                    //stat.isDirectory()目录返回true
                    if(stat && stat.isDirectory()) {
                        itemLink = path.join(itemLink, '/')
                    }
                content += `<p><a href="${itemLink}">${file}</a></p>`
                })
                res.writeHead(200, {
                    'Content-Type': 'text/html'
                })
                res.end(content)
            })
        }
    }

    //定义处理路由的routehandler()函数
    routeHandler(pathName, req, res) {
        //禁用favico.ico请求
        // if (req.url === '/favicon.ico') {
        //     return
        // }
        //使用fs.stat(path, callback(err, stats))检测文件状态 判断是文件还是目录
        fs.stat(pathName, (err, stat) => {
            if (!err) {
                let requestedPath = url.parse(req.url).pathname
                //请求末尾有斜杠，且是目录
                if (hasTrailingSlash(requestedPath) && stat.isDirectory()) {
                    this.respondDirectory(pathName, req, res)
                    //末尾无斜杠
                } else if(stat.isDirectory()) {
                    this.respondRedirect(req, res)
                    //请求的是文件
                }else {
                    this.respond(pathName, req, res)
                }
                // this.respond(pathName, req, res)
            }else {
                console.error(err)
                this.responseNotFound(req, res)
            }
        })
    }
    //定义start()方法
    start() {
        //创建web服务器 自动监听request事件
        http.createServer((req, res) => {
            //path.join)（）将所有参数连接在一起
            //path.normalize（）转化路径的各部分，将'..'和'.'替换为实际的路径
            let pathName = path.join(this.root, path.normalize(req.url))
            // if (pathName == './'){
            //     pathName = './index.html';
            // }
            //res.writeHead(200)
            //等价于res.write(`Request path: ${pathName}`) +  res.end()
            //res.end(`Request path: ${pathName}`)
            this.routeHandler(pathName, req, res)
            //监听端口号
        }).listen(this.port, err => {
            if (err) {
                console.error(err)
                console.info('Failed to start server')
            }else {
                console.info(`Server started on port ${this.port}`)
            }
        })
    }
}
//暴露接口
module.exports = StaticServer