const path = require('path')
//设置mime类型
const mimeTypes = {
    '.html':'text/html',
    '.js':'text/javascript',
    '.css':'text/css',
    '.json':'application/json',
    '.png':'image/png',
    '.jpg':'image/jpg',
    '.gif':'image/gif',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.svg': 'application/image/svg+xml',
    '.txt':'text/plain'
}
const getExtname = (pathName) => {
    //path.extname(pathname) 返回路径中文件的后缀名,即最后一个'.'之后的部分
    // let ext = path.extname(pathName)
    let extname = String(path.extname(pathName)).toLowerCase();
    return mimeTypes[extname] || mimeTypes['.txt']
}
module.exports = {
    getExtname
}