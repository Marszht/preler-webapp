# 拼豆底稿生成器
一个轻量、开源的拼豆图案转换工具，可以把任意图片转换成拼豆底稿，自动计算所需拼豆颜色和数量。
## ✨ 核心功能
- 🎨 支持自定义底稿尺寸（10-200格）
- 🖼️ 自动裁切图片主体、自动去除背景
- 🌈 支持221色MARD拼豆色卡，可限制最大使用颜色数
- 🎛️ 提供亮度/对比度/饱和度调整
- 🧩 3种抖动算法（无抖动/ Floyd-Steinberg / Atkinson），可调整抖动强度
- 📊 自动统计所需拼豆的颜色和数量，支持导出清单
- 🌐 纯Web界面，无需安装客户端，所有处理在内存中完成
## 🚀 本地运行
```bash
# 1. 克隆仓库
git clone <仓库地址>
cd perler-webapp
# 2. 安装依赖
npm install
# 3. 启动服务
node server.js
# 4. 打开浏览器访问 http://localhost:3000
```
## 🌍 在线演示
已部署到Vercel：[https://preler-app.vercel.app/](https://preler-app.vercel.app/)
## 📦 部署
项目已配置好Vercel部署文件，直接导入GitHub仓库即可一键部署：
- 无构建步骤，自动识别`npm install`和`npm start`命令
- 所有图像处理在内存中完成，不需要数据库或持久化存储
- 免费额度完全满足个人使用需求
## 🛠️ 技术栈
- 后端：Express + Jimp（纯JS图片处理，无原生依赖）
- 前端：原生HTML/CSS/JS + Canvas渲染
- 核心算法：CIEDE2000颜色距离计算、区域平均缩放、斑点去除
