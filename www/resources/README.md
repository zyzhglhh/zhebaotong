在上一级目录中运行如下命令(该目录中必须有./resources文件夹, 文件夹中包含icon.png和splash.psd模板; 该目录中必须包含config.xml文件, 该命令生成资源后会重写config.xml文件):
```bash
$ ionic resources ios  # 如果没有platform added, 则需要指定平台生成资源, 加参数ios
$ ionic resources android  # 同上
$ ionic resources --icon  # 只生成icon
$ ionic resources --splash  # 只生成splash
```

!!!注意: 如果是用PhoneGap Build编译的App, 还是要遵循其[规范](http://docs.build.phonegap.com/en_US/configuring_icons_and_splash.md.html), 需要重新修改config.xml(主要是采用命名空间gap下的标签gap:splash, 和同样命名空间下的gap:platform以及Android的gap:qualifier等属性来指定splash图片)