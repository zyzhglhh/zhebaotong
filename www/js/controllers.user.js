angular.module('yiyangbao.controllers.user', [])
.controller('userTabsBottom', ['$scope', '$timeout', function ($scope, $timeout) {
    $scope.newConsNum = 1;
    $scope.actions = {
        clearConsBadge: function () {
            $timeout(function() {
                $scope.newConsNum = 0;
            }, 500);
        }
    };
}])
.controller('userHome', ['$scope', '$q', '$timeout', 'PageFunc', 'Storage', 'User', 'Consumption', 'Socket', '$ionicHistory', function ($scope, $q, $timeout, PageFunc, Storage, User, Consumption, Socket, $ionicHistory) {
    var init = function () {
        var deferred = $q.defer();
        var deferredInfo = $q.defer(), 
            deferredBarcode = $q.defer(); 
        User.initAccInfo($scope).then(function (data) { 

            deferredInfo.resolve(data);
        }, function (err) {
            deferredInfo.reject(err);
        });
        Socket.default.emit('pay bill', null, null, null, function (socketId) { 
            
            deferredBarcode.resolve(socketId);
        });
        $timeout(function () { 
            deferredBarcode.reject('连接超时!');
        }, 10000);
        $q.all([deferredInfo.promise, deferredBarcode.promise]).then(function (data) { 

            $scope.accountInfo.barcode = data[1] + ')|(' + (data[0].amountInfo.available || 0);
            console.log($scope.accountInfo.barcode);
            deferred.resolve();
        }, function (errors) {
            console.log(errors);
            deferred.reject();
        });
        return deferred.promise;
    };
    Socket.default.on('pay bill', function (data, actions, options, cb) { 

        var AccInfo = JSON.parse(Storage.get('AccInfo'));
        var userId = AccInfo.user._id;

        // 考虑到一个用户有多保单的情况下,浙保通下 inceType = 5 医疗补充保险金额可以进行线下消费,把这条保单筛选出来
        var ince = AccInfo.inces.filter(function(ince){
            if ( ince.inceType === '5') {
                return true;
            }
        })[0] || {};


        var socketData = data;
        if (actions === 'check') {
            PageFunc.prompt('消费金额: ' + socketData.money + '元', '请输入支付密码').then(function (res) {
                if (res) {
                    var cons = {
                        userId: userId,
                        money: socketData.money,
                        consType: 'medi',
                        note: socketData.note,
                        seriesNum: ince.seriesNum,
                        mediId: socketData.mediId,
                        incePolicyId: ince._id,
                        unitId: ince.unitId,
                        inceId: ince.inceId,
                        servId: ince.servId,
                        password: res
                    };
                    cons.outOrgUid = socketData.outOrgUid || undefined;
                    cons.outShopUid = socketData.outShopUid || undefined;
                    cons.outRecptNum = socketData.outRecptNum || undefined;
                    cons.items = socketData.items || undefined;
                    cons.status = socketData.status || undefined;
                    Consumption.insertOne(cons).then(function (data) {
                        $scope.error.payError = '您消费' + data.results.cons.money + '元!'; 
                        Socket.default.emit('pay bill', {mediSocketId: socketData.mediSocketId, msg: '用户支付' + data.results.cons.money + '元!'}, 'paid');
                        $scope.accountInfo.amountInfo.available = data.results.amountInfo.available;
                        $scope.accountInfo.amountInfo.consumed = data.results.amountInfo.consumed;
                        $scope.accountInfo.amountInfo.freeze = data.results.amountInfo.freeze;
                        $scope.accountInfo.barcode = $scope.accountInfo.barcode.split(')|(')[0] + ')|(' + data.results.amountInfo.available;
                    }, function (err) {
                        $scope.error.payError = err.data; 
                        Socket.default.emit('pay bill', {mediSocketId: socketData.mediSocketId, msg: err.data}, 'payError');
                    });
                }
                else {
                    Socket.default.emit('pay bill', {mediSocketId: socketData.mediSocketId}, 'cancelPay');
                }
            });
        }
    });
    $scope.actions = {
        doRefresh: function() {
            init()
            .catch(function (err) { 
                console.log(err);
            })
            .finally(function () {
                $scope.$broadcast('scroll.refreshComplete');
            });
        }
    };
    $scope.$on('$ionicView.beforeEnter', function () {
        init();
    });
    $scope.$on('$destroy', function () {
        Socket.getSocket().removeAllListeners(); 
    });
}])
.controller('userApply', ['$scope', '$state', 'User', 'Consumption', 'PageFunc', '$ionicHistory', '$ionicSlideBoxDelegate', function ($scope, $state, User, Consumption, PageFunc, $ionicHistory, $ionicSlideBoxDelegate) {
    $scope.config = {
        relations: ['本人','配偶','母/婚姻父母','子女','兄弟姐妹'],
        unitTypes: ['pub', 'priv'], 
        inceTypes: [],
        mediTypes: {}, 
        curMediTypes: [],
        out: [{title: '病历页'}, {title: '发票'}],
        'in': [{title: '出院小结'}, {title: '用药清单'}, {title: '发票'}],
        images: [{title: '身份证正面'}, {title: '身份证反面'}, {title: '病历首页'}, {title: '银行卡'}]
    };

    $scope.error = {};
    $scope.data = {};
    var inces = {}, slideIndex = {};

    
    $scope.actions = {
        apply: function() {
            if ($scope.cons.consumer.relation === '本人') $scope.cons.consumer = {relation: '本人'};
            if ($scope.cons.unitType === 'pub') delete $scope.cons.prop;
            if ($scope.cons.unitType === 'priv') delete $scope.cons.ownPay;

            Consumption.applyOne($scope.cons).then(function (data) {
                
                $scope.cons = {
                    employeeId: $scope.accountInfo.user.personalInfo.employeeId,
                    consumer: {idType: "身份证"}, 
                    visitDate: {},
                    status: {
                        isSubmitted: false,
                        isRevoked: false,
                        isAudited: false
                    },
                    consType: "self"
                };
                data.results.cons.userId = $scope.accountInfo.user;
                $state.go('user.ConsDetail', {consId: data.results.cons._id, cons: data.results.cons, conf: {showBarBtn: true}});
            }, function (err) {
                $scope.error.applyError = err.data;
            });
        },
        doRefresh: function() {
            User.initAccInfo($scope).then(function (data) {
                
                $scope.config.inceTypes = [];

                for (var i=0; i < data.inces.length; i++) {
                    $scope.config.inceTypes.push(data.inces[i].inceType);
                    $scope.config.mediTypes[ data.inces[i].inceType ] = [];

                    slideIndex[data.inces[i].inceType] =  i;
                    for(var j = 0; j < data.inces[i].amountDetails.length; j++ ){

                        $scope.config.mediTypes[ data.inces[i].inceType ].push(data.inces[i].amountDetails[j]);
                        $scope.meidTypeOne = $scope.config.mediTypes[ data.inces[i].inceType ];
                    }
                    $scope.isMore = Object.keys($scope.config.mediTypes).length > 1;
                    $scope.isOne = Object.keys($scope.config.mediTypes).length == 1;
                    inces[data.inces[i].inceType] = {
                        incePolicyId: data.inces[i]._id,
                        unitId : data.inces[i].unitId._id,
                        inceId : data.inces[i].inceId._id,
                        servId : data.inces[i].servId._id,
                        inceGenNum: data.inces[i].inceGenNum,
                    }
                }

                $scope.cons = {
                    employeeId: data.user.personalInfo.employeeId,
                    consumer: {
                        relation: '本人', 
                        idType: "身份证"
                    }, 
                    visitDate: {
                        start: new Date(Date.now() - 86400000), 
                        end: new Date() 
                    },
                    status: {
                        isSubmitted: false,
                        isRevoked: false,
                        isAudited: false
                    },
                    consType: "self", 
                    money: 12, 
                    outName: '浙江大学医院', 
                    unitType: 'pub', 
                    note: '我要申请理赔', 
                    ownPay: 6, 
                    receiptTotalAmount: 2 
                };
                if (!data.user.personalInfo.idImg || data.user.personalInfo.idImg.length < $scope.config.images.length) {
                    $scope.actions.chgIdImg();
                }
                $scope.$broadcast('scroll.refreshComplete');
            }, function (err) {
                console.log(err);
                $scope.$broadcast('scroll.refreshComplete');
            });
        },
        chgIdImg: function () {
            $scope.config.title = '拍摄证件照片';

            if ($scope.takePicsModal) {
                $scope.takePicsModal.show();
            }
            else {
                User.takePicsModal($scope, $scope.accountInfo.user.personalInfo.idImg);
            }
        },
        chgIdNo: function (idNo) {
            if (idNo) {
                PageFunc.prompt('登录密码', '请输入密码查看身份证').then(function (res) {
                    if (res) {
                        User.verifyPwd(res).then(function (data) {
                            if (data.results === 'OK') {
                                PageFunc.message('身份证号码: ' + idNo + ', 如有错误, 请联系服务专员修改!<br><a ng-href="tel:' + CONFIG.serv400.number + '">' + CONFIG.serv400.caption + '</a>');
                            }
                            else {
                                $ionicLoading.show({
                                    template: '<span>密码错误</span>',
                                    duration: 800
                                });
                            }
                        }, function (err) {
                            $ionicLoading.show({
                                template: '<span>密码错误</span>',
                                duration: 800
                            });
                            console.log(err.data);
                        });
                    }       
                });
                return;
            }
            PageFunc.prompt('登录密码', '请输入密码设置身份证').then(function (res) {
                if (res) {
                    User.verifyPwd(res).then(function (data) {
                        if (data.results === 'OK') {
                            $scope.config.title = '设置身份证';
                            $scope.data.key = 'personalInfo.idNo';
                            $scope.data.value = idNo;
                            $scope.actions.show();
                        }
                        else {
                            $ionicLoading.show({
                                template: '<span>密码错误</span>',
                                duration: 1500
                            });
                        }
                    }, function (err) {
                        $ionicLoading.show({
                            template: '<span>密码错误</span>',
                            duration: 1500
                        });
                        console.log(err.data);
                    });
                }       
            });
        },
        chgInceType: function (type) {
            $scope.config.curMediTypes = $scope.config.mediTypes[type];
            $scope.cons['incePolicyId'] = inces[type].incePolicyId;
            $scope.cons['unitId'] = inces[type].unitId;
            $scope.cons['inceId'] = inces[type].inceId;
            $scope.cons['servId'] = inces[type].servId;
            $scope.cons['inceGenNum'] = inces[type].inceGenNum;

            //if (type === 'welf') var index = 0;
            //if (type === 'commer') var index = 1;
            var index = slideIndex[type];
            $ionicSlideBoxDelegate.$getByHandle('inceType').slide(index, 800);
        }
    };

    User.updateModal($scope);
    $scope.$on('$ionicView.beforeEnter', function () {
        $scope.actions.doRefresh();
    });
}])
.controller('userConsList', ['$scope', '$q', '$ionicPopover', 'Consumption', 'PageFunc', '$cordovaBarcodeScanner', '$ionicHistory', 'Storage', '$stateParams', '$ionicHistory', function ($scope, $q, $ionicPopover, Consumption, PageFunc, $cordovaBarcodeScanner, $ionicHistory, Storage, $stateParams, $ionicHistory) {
    var batch = null;
    var lastTime = null; 
    var consList = [];
    var init = function () {
        var deferred = $q.defer();
        Consumption.getList(null, {skip: 0, limit: batch}).then(function (data) {
            consList = data.results;
            $scope.items = consList.filter(function (item) {
                if ((!item.status.isSubmitted && !item.status.isAudited && !item.status.isRevoked && !item.status.isDone) || (item.status.isSubmitted && !item.status.isAudited && !item.status.isRevoked && !item.status.isDone && $scope.filters.checkBoxItems[0].checked === true) || (item.status.isAudited && !item.status.isDone && $scope.filters.checkBoxItems[1].checked === true) || (item.status.isRevoked && $scope.filters.checkBoxItems[2].checked === true) || (item.status.isDone && $scope.filters.checkBoxItems[3].checked === true)) {
                    if (item.receiptImg && item.receiptImg[0]) {
                        item.receiptImgUrl = item.receiptImg[0].Url.replace(/\/([^\/]+?\.[^\/]+?)$/, '/thumb/sm_$1'); 
                    }
                    return true;
                }
            });
            lastTime = Date.now(); 
            deferred.resolve();
        }, function (err) {
            console.log(err.data);
            deferred.reject();
        });
        return deferred.promise;
    };
    $scope.$on('$ionicView.beforeEnter', function () { 
        var thisMoment = Date.now();
        if ((thisMoment - lastTime)/3600000 > 1) {
            init();
        }
        if ($stateParams.action) {
            $scope.actions[$stateParams.action]();
        }
    });
    $scope.filters = {
        title: '消费记录筛选',
        isCheckBox: true,
        checkBoxItems: [
            { text: "已提交", checked: true },
            { text: "已审核", checked: false },
            { text: "已核销", checked: false },
            { text: "已完成", checked: false }
        ],
        height: '280px'
    };
    $ionicPopover.fromTemplateUrl('partials/popover/filter.html', {
        scope: $scope
    }).then(function (popover) {
        $scope.filterPopover = popover;
    });
    $scope.$on('$destroy', function () {
        $scope.filterPopover.remove();
    });
    $scope.actions = {
        doRefresh: function () {
            init()
            .catch(function (err) { 
                console.log(err);
            })
            .finally(function () {
                $scope.$broadcast('scroll.refreshComplete');
            });
        },
        showFilter: function ($event) {
            $scope.filterPopover.show($event);
        },
        closeFilter: function () {
            $scope.filterPopover.hide();
        },
        filterItems: function () {
            $scope.items = consList.filter(function (item) {
                if ((!item.status.isSubmitted && !item.status.isAudited && !item.status.isRevoked && !item.status.isDone) || (item.status.isSubmitted && !item.status.isAudited && !item.status.isRevoked && !item.status.isDone && $scope.filters.checkBoxItems[0].checked === true) || (item.status.isAudited && !item.status.isDone && $scope.filters.checkBoxItems[1].checked === true) || (item.status.isRevoked && $scope.filters.checkBoxItems[2].checked === true) || (item.status.isDone && $scope.filters.checkBoxItems[3].checked === true)) {
                    if (item.receiptImg && item.receiptImg[0]) {
                        item.receiptImgUrl = item.receiptImg[0].Url.replace(/\/([^\/]+?\.[^\/]+?)$/, '/thumb/sm_$1'); 
                    }
                    return true;
                }
            });
        },
        scan: function (event) {
            if (!(window.cordova && window.cordova.plugins && window.cordova.plugins.barcodeScanner)) {
                return PageFunc.message('不支持扫码!', 2000);
            }
            $cordovaBarcodeScanner.scan().then(function (result) {
                if (result.cancelled) {
                    $ionicHistory.goBack(0); 
                    return console.log('用户取消!');
                }
                Consumption.getOne({_id: result.text}).then(function (data) {
                    var cons = data.results;
                    $scope.items = consList.filter(function (item) {
                        if (item._id === cons._id) {
                            if (cons.status.isRevoked === true) {
                                return PageFunc.message('申请已退回!', 2000);
                            }
                            if (cons.status.isDone === true) {
                                return PageFunc.message('申请已通过!', 2000);
                            }
                            return true;
                        }
                    });
                    if ($scope.items.length === 0) {
                        PageFunc.message('理赔申请不存在!', 2000);
                    }
                }, function (err) {
                    PageFunc.message('理赔申请不存在!', 2000);
                });
            }, function (err) {
                PageFunc.message('扫码错误!', 2000);
            });
        }
    };
}])
.controller('userConsDetail', ['$q', '$scope', '$state', '$stateParams', '$cordovaCamera', '$cordovaFileTransfer', '$timeout', '$ionicLoading', 'PageFunc', 'Consumption', 'CONFIG', 'Storage', '$ionicScrollDelegate', function ($q, $scope, $state, $stateParams, $cordovaCamera, $cordovaFileTransfer, $timeout, $ionicLoading, PageFunc, Consumption, CONFIG, Storage, $ionicScrollDelegate) {
    $scope.error = {};
    $scope.input = {};
    var cameraOptions = CONFIG.cameraOptions;
    var uploadOptions = CONFIG.uploadOptions; 
    $scope.pageHandler = {
        progress: 0,
        showDelete: false
    };



    $scope.actions = {
        showDelete: function () {
            $scope.pageHandler.showDelete = !$scope.pageHandler.showDelete;
        },
        deleteImg: function (img, $index) {
            PageFunc.confirm('是否确认删除?', '删除图片').then(function (res) {
                if (res) {
                    Consumption.updateOne({_id: $stateParams.consId, pull: {Url: img.Url, path: img.path, title: img.title, type: img.type, No: img.No}}).then(function (data) {
                    }, function (err) {
                        $scope.error.receiptError = err.data;
                        console.log(err.data);
                    });
                    item.receiptImg.splice($index, 1);
                    item.receiptImgThumb.splice($index, 1);
                }
            });
        },
        takePic: function (type) {
            if (!(window.navigator && window.navigator.camera)) {
                return console.log('不支持window.navigator.camera');
            }
            var deferred = $q.defer();
            if (type === 'recpt') {
                PageFunc.prompt('请输入单据号', '单据号', 'text').then(function (res) {
                    if (res) return deferred.resolve(res);
                    deferred.reject('必须输入发票号');
                });
            }
            else {
                deferred.resolve();
            }
            $q.all([deferred.promise]).then(function (res) {
                $cordovaCamera.getPicture(cameraOptions).then(function (imageURI) {
                    $timeout(function () {
                        var serverUrl = encodeURI(CONFIG.baseUrl + CONFIG.consReceiptUploadPath);
                        uploadOptions.headers = {Authorization: 'Bearer ' + Storage.get('token')};
                        uploadOptions.fileName = $stateParams.consId + CONFIG.uploadOptions.fileExt;
                        uploadOptions.params = {_id: $stateParams.consId, No: res[0] || undefined, type: type};
                        PageFunc.confirm('是否上传?', '上传图片').then(function (res) {
                            if (res) {
                                $ionicLoading.show({
                                    template: '<ion-spinner style="height:2em;width:2em"></ion-spinner>'
                                });
                                if (!window.FileTransfer) {
                                    $ionicLoading.hide();
                                    return console.log('不支持window.FileTransfer');
                                }
                                return $cordovaFileTransfer.upload(serverUrl, imageURI, uploadOptions, true).then(function (result) {
                                    $scope.pageHandler.progress = 0; 
                                    $ionicLoading.hide();
                                    $scope.error.receiptError = '上传成功!'; 
                                    $scope.item.receiptImg = JSON.parse(result.response).results.receiptImg; 
                                    $scope.item.receiptImgThumb = $scope.item.receiptImg.filter(function (img) {
                                        if (img) {
                                            img.urlThumb = img.Url.replace(/\/([^\/]+?\.[^\/]+?)$/, '/thumb/$1'); 
                                        }
                                        return true;
                                    });
                                    try {
                                        $cordovaCamera.cleanup().then(function () { 
                                        }, function (err) {
                                            console.log(err);
                                        });
                                    }
                                    catch (e) {
                                        console.log(e);
                                    }
                                }, function (err) {
                                    console.log(err);
                                    $scope.error.receiptError = err;
                                    $scope.pageHandler.progress = 0;
                                    $ionicLoading.hide();
                                    try {
                                        $cordovaCamera.cleanup().then(function () { 
                                        }, function (err) {
                                            console.log(err);
                                        });
                                    }
                                    catch (e) {
                                        console.log(e);
                                    }
                                }, function (progress) {
                                    $scope.pageHandler.progress = progress.loaded / progress.total * 100;
                                });
                            }
                            $scope.pageHandler.progress = 0;
                            $scope.error.receiptError = '取消上传!';
                            try {
                                $cordovaCamera.cleanup().then(function () { 
                                }, function (err) {
                                    console.log(err);
                                });
                            }
                            catch (e) {
                                console.log(e);
                            }
                        });
                    }, 0);
                }, function (err) {
                    $scope.error.receiptError = err;
                    console.log(err);
                });
            }, function (err) {
                $ionicLoading.show({
                    template: '<span>' + err + '</span>',
                    duration: 800
                });
            });
        },
        submit: function () {
            PageFunc.confirm('是否提交?', '提交记录').then(function (res) {
                if (res) {
                    return Consumption.updateOne({_id: $stateParams.consId, set: 'submit'}).then(function (data) {
                        $scope.item = data.results;
                        $scope.item.receiptImgThumb = $scope.item.receiptImg.filter(function (img) {
                            if (img) {
                                img.urlThumb = img.Url.replace(/\/([^\/]+?\.[^\/]+?)$/, '/thumb/$1'); 
                            }
                            return true;
                        });
                        $scope.error.receiptError = '提交成功!';
                    }, function (err) {
                        $scope.error.receiptError = err.data;
                        console.log(err.data);
                    });
                }
            });
        },
        doRefresh: function () {
            init(true)
            .catch(function (err) { 
                console.log(err);
            })
            .finally(function () {
                $scope.$broadcast('scroll.refreshComplete');
            });
        },
        viewer: function ($index, group) {
            var images = group && $scope.item.userId.personalInfo.idImg || $scope.item.receiptImg;
            PageFunc.viewer($scope, images, $index);
        },
        revokeItem: function (item) {

            PageFunc.confirm('是否确认撤销理赔申请?', '撤销').then(function (res) {
                if (res) {
                    Consumption.updateOne({_id: item._id, set: 'revoke'}).then(function (data) {
                        item.status.isRevoked = data.results.cons.status.isRevoked;
                    }, function (err) {
                        $scope.error.receiptError = err.data;
                        console.log(err.data);
                    });
                }
            });
        },
        ask: function () {
            var comment = {
                _id: $scope.item._id,
                content: $scope.input.message
            };
            Consumption.comment(comment).then(function (data) {
                $scope.item.comments = data.results;
                $scope.input.message = '';
                $ionicScrollDelegate.scrollBottom();
            }, function(err){
                console.log(err);
            });
        }
    };


    var init = function (refresh) {
        var deferred = $q.defer();
        
        Consumption.getOne({_id: $stateParams.consId}).then(function (data) {
            $scope.item = data.results;

            $scope.item.btnSubmitActive = (data.results.mediType.photoSet.length === data.results.receiptImg.length);
            console.log($scope.item.btnSubmitActive);
            $scope.item.receiptImgThumb = $scope.item.receiptImg.filter(function (img) {
                if (img) {
                    img.urlThumb = img.Url.replace(/\/([^\/]+?\.[^\/]+?)$/, '/thumb/$1'); 
                }
                return true;
            });
            $scope.item.idImgThumb = $scope.item.userId.personalInfo.idImg.filter(function (img) {
                if (img) {
                    img.urlThumb = img.Url.replace(/\/([^\/]+?\.[^\/]+?)$/, '/thumb/$1'); 
                }
                return true;
            });
            deferred.resolve();
        }, function (err) {
            deferred.reject();
            console.log(err.data);
        });
        

        return deferred.promise;
    };
    init();

    $scope.$on('$ionicView.afterEnter', function () { 
        if ($stateParams.conf) {
            $scope.conf = $stateParams.conf;
        }
    });

}])
.controller('userActivities', ['$scope', function ($scope) {
}])

.controller('userMine', ['$scope', '$ionicPopup', '$q', '$ionicActionSheet', '$cordovaCamera', '$cordovaFileTransfer', 'Storage', 'User', '$timeout', 'PageFunc', 'CONFIG', 'Token', '$stateParams', function ($scope, $ionicPopup, $q, $ionicActionSheet, $cordovaCamera, $cordovaFileTransfer, Storage, User, $timeout, PageFunc, CONFIG, Token, $stateParams) {
    $scope.config = {
        genders: CONFIG.genders,
        q1: CONFIG.q1,
        q2: CONFIG.q2,
        q3: CONFIG.q3,
        images: [{title: '身份证正面'}, {title: '身份证反面'}, {title: '病历首页'}, {title: '银行卡'}]
    };
    $scope.pageHandler = {
        progress: 0
    };
    $scope.data = {};
    var cameraOptions = angular.copy(CONFIG.cameraOptions), 
        uploadOptions = angular.copy(CONFIG.uploadOptions);
    User.initAccInfo($scope);
    $scope.actions = {
        doRefresh: function() {
            User.initAccInfo($scope)
            .catch(function (err) { 
                console.log(err);
            })
            .finally(function () {
                $scope.$broadcast('scroll.refreshComplete');
            });
        },
        chgHead: function () {
            var hideSheet = $ionicActionSheet.show({
                buttons: [
                   { text: '<b>拍摄头像</b>' },
                   { text: '相册照片' }
                ],
                titleText: '设置头像',
                cancelText: '取消',
                cancel: function() {
                },
                buttonClicked: function(index) {
                    cameraOptions.allowEdit = true;
                    cameraOptions.targetWidth = 800;
                    cameraOptions.targetHeight = 800;
                    cameraOptions.cameraDirection = 1;
                    switch (index) {
                        case 0: {
                            cameraOptions.sourceType = 1;
                        }
                        break;
                        case 1: {
                            cameraOptions.sourceType = 2;
                        }
                        break;
                    }
                    if (!(window.navigator && window.navigator.camera)) {
                        return console.log('不支持window.navigator.camera');
                    }
                    $cordovaCamera.getPicture(cameraOptions).then(function (imageURI) {
                        $timeout(function () {
                            var serverUrl = encodeURI(CONFIG.baseUrl + CONFIG.userResUploadPath);
                            uploadOptions.headers = {Authorization: 'Bearer ' + Storage.get('token')};
                            uploadOptions.fileName = 'userHead' + CONFIG.uploadOptions.fileExt;
                            uploadOptions.params = {method: '$set', dest: 'head', replace: true}; 
                            PageFunc.confirm('是否上传?', '上传头像').then(function (res) {
                                if (res) {
                                    if (!window.FileTransfer) {
                                        return console.log('不支持window.fileTransfer');
                                    }
                                    return $cordovaFileTransfer.upload(serverUrl, imageURI, uploadOptions, true).then(function (result) {
                                        $scope.pageHandler.progress = 0;
                                        $scope.accountInfo.user.head = {Url: JSON.parse(result.response).results.Url};
                                        try {
                                            $cordovaCamera.cleanup().then(function () { 
                                                console.log("Camera cleanup success.");
                                            }, function (err) {
                                                console.log(err);
                                            });
                                        }
                                        catch (e) {
                                            console.log(e);
                                        }
                                    }, function (err) {
                                        console.log(err);
                                        $scope.error.headError = err;
                                        $scope.pageHandler.progress = 0;
                                        try {
                                            $cordovaCamera.cleanup().then(function () { 
                                                console.log("Camera cleanup success.");
                                            }, function (err) {
                                                console.log(err);
                                            });
                                        }
                                        catch (e) {
                                            console.log(e);
                                        }
                                    }, function (progress) {
                                        $scope.pageHandler.progress = progress.loaded / progress.total * 100;
                                    });
                                }
                                $scope.pageHandler.progress = 0;
                                $scope.error.headError = '取消上传!';
                                try {
                                    $cordovaCamera.cleanup().then(function () { 
                                        console.log("Camera cleanup success.");
                                    }, function (err) {
                                        console.log(err);
                                    });
                                }
                                catch (e) {
                                    console.log(e);
                                }
                            });
                        }, 0);
                    }, function (err) {
                        $scope.error.headError = err;
                        console.log(err);
                    });
                    return true;
                }
            });
        },
        chgUsername: function () {
            if ($scope.accountInfo.user.username !== $scope.accountInfo.user.personalInfo.idNo) {
                return;
            }
            $scope.config.title = '修改用户名';
            $scope.data.key = 'username';
            $scope.data.value = $scope.accountInfo.user.username;
            $scope.actions.show();
        },
        chgMobile: function () {
            var smsType, title, msg;
            if ($scope.accountInfo.user.mobile) {
                smsType = '-chgBind';
                title = '修改手机号';
                msg = '请输入当前绑定手机号';
            }
            else {
                smsType = '-initBind';
                title = '绑定手机号';
                msg = '请输入手机号';
            }
            if ($scope.bindMobileModal) {
                $scope.bindMobileModal.show();
            }
            else {
                User.bindMobileModal(Token.curUserRole(), smsType, $scope.accountInfo.user.mobile, title, msg, true);
            }
        },
        chgEmail: function () {
            $scope.config.title = '修改邮箱地址';
            $scope.data.key = 'email';
            $scope.data.value = $scope.accountInfo.user.email;
            $scope.actions.show();
        },
        chgAccountNo: function () {
            $scope.config.title = '修改银行卡号';
            $scope.data.key = 'extInfo.yiyangbaoHealInce.accountNo';
            $scope.data.value = $scope.accountInfo.user.extInfo.yiyangbaoHealInce.accountNo;
            $scope.actions.show();
        },
        chgPwd: function () {
            if ($scope.passwordModal) {
                $scope.passwordModal.show();
            }
            else {
                User.passwordModal($scope);
            }
        },
        chgPwdQst: function () {
            PageFunc.prompt('登录密码', '请输入登录密码').then(function (res) {
                if (res) {
                    User.verifyPwd(res).then(function (data) {
                        if (data.results === 'OK') {
                            $scope.config.title = '设置密保问题';
                            if ($scope.pwdQstModal) {
                                $scope.pwdQstModal.show();
                            }
                            else {
                                User.pwdQstModal($scope);
                            }
                        }
                    }, function (err) {
                        console.log(err.data);
                    });
                }
                else {
                }
            });
        },
        chgDealPwd: function () {
            if ($scope.dealPasswordModal) {
                $scope.dealPasswordModal.show();
            }
            else {
                User.dealPasswordModal($scope, $scope.accountInfo.user.extInfo.yiyangbaoHealInce.dealPassword, true);
            }
        },
        chgName: function () {
            $scope.config.title = '修改姓名';
            $scope.data.key = 'personalInfo.name';
            $scope.data.value = $scope.accountInfo.user.personalInfo.name;
            $scope.actions.show();
        },
        chgGender: function (gender) {
            User.updateOne({'personalInfo.gender': gender}).then(function (data) {
            }, function (err) {
                console.log(err.data);
            });
        },
        chgBirthdate: function (birthdate) {
            if (!birthdate) {
                $scope.accountInfo.user.personalInfo.birthdate = new Date(JSON.parse(Storage.get('AccInfo')).user.personalInfo.birthdate);
                return PageFunc.message('生日不能为空!');
            }
            User.updateOne({'personalInfo.birthdate': birthdate}).then(function (data) {
            }, function (err) {
                console.log(err.data);
            });
        },
        chgIdNo: function () {
            PageFunc.message('如有错误, 请联系服务专员修改!<br><a ng-href="tel:' + CONFIG.serv400.number + '">' + CONFIG.serv400.caption + '</a>');
        },
        chgLocation: function () {
            $scope.config.title = '修改地址';
            $scope.data.key = 'personalInfo.location.city.name';
            $scope.data.value = $scope.accountInfo.user.personalInfo.location && $scope.accountInfo.user.personalInfo.location.city && $scope.accountInfo.user.personalInfo.location.city.name;
            $scope.actions.show();
        },
        chgIdImg: function () {
            $scope.config.title = '拍摄证件照片';
            if ($scope.takePicsModal) {
                $scope.takePicsModal.show();
            }
            else {
                User.takePicsModal($scope, $scope.accountInfo.user.personalInfo.idImg);
            }
        }
    };
    $scope.$on('$ionicView.loaded', function () { 
        User.updateModal($scope);
    });
}])
.controller('userHelper', ['$scope', function ($scope) {
}])
.controller('userSettings', ['$scope', '$ionicPopup', '$q', 'Storage', 'User', function ($scope, $ionicPopup, $q, Storage, User) {
    User.initAccInfo($scope);
    $scope.actions = {
        doRefresh: function() {
            User.initAccInfo($scope)
            .catch(function (err) { 
                console.log(err);
            })
            .finally(function () {
                $scope.$broadcast('scroll.refreshComplete');
            });
        },
        clearCache: function () {
            var token = Storage.get('token') || '';
            var refreshToken = Storage.get('refreshToken') || '';
            var myAppVersionLocal = Storage.get('myAppVersion') || '';
            Storage.clear();
            if (token) Storage.set('token', token);
            if (refreshToken) Storage.set('refreshToken', refreshToken);
            if (myAppVersionLocal) Storage.set('myAppVersion', myAppVersionLocal);
            $ionicPopup.alert({title: '缓存', template: '<h4><b>清理成功</b></h4>'});
        },
        logout: function () {
            User.logout($scope);
        }
    };
}])
.controller('userFeedback', ['$scope', function ($scope) {
}])
.controller('userSearch', ['$scope', function ($scope) {
}])
.controller('userHealth', ['$scope', function($scope){
}])
.controller('userOnlinecart', ['$scope', function($scope){
}])
.controller('userKenbei', ['$scope', function($scope){
}])
.controller('userBxproduct', ['$scope', function($scope){
}])
.controller('userMyguang', ['$scope', function($scope){
}])
.controller('userYangsheng', ['$scope', function($scope){
}])
.controller('userArticle', function($scope, $stateParams){
    console.log($stateParams.typeid, $stateParams.id);
    var articles = ['健康管理','线上药店','健康商城','保险产品', '名医馆','名家养生'];
    var article = $scope.article = {};
    article.catname= articles[$stateParams.typeid];
    article.title = '杭州颐养网络科技有限公司';
})

.controller('userYljBalanceCtrl', ['$scope', 'Insurance', function($scope, Insurance) {
    
    var initYljInfo = function() {
        Insurance.getYljInfo({}).then(function(data) {
            $scope.ince = data.results;
            $scope.yljDetails = [];

            var inceItems = data.results.inceItems;
            var sumUnitAmount = 0, sumProfileAmount = 0;
            var total = {
                sumUnitAmount: 0,
                sumProfileAmount: 0,
                sumUnitInterest: 0,
                sumInterest: 0
            };
            for(var i = 0; i < inceItems.length; i++) {
                inceItems[i].month = new Date(inceItems[i].month);
                inceItems[i].startTime = new Date(inceItems[i].startTime);
                inceItems[i].createTime = new Date(inceItems[i].createTime);
                var dt = inceItems[i].detailType.substring(inceItems[i].detailType.length -1);
                if ( dt == '1' || dt == '3' || dt== '4') {  //统计投保与支出 1=投保 2=利息 3=支出 4=分红
                    total.sumUnitAmount += parseFloat(inceItems[i].unitPrice);
                    total.sumProfileAmount += parseFloat(inceItems[i].price);
                    total.sumUnitInterest += parseFloat(inceItems[i].cycleUnitInterest);
                    total.sumInterest += parseFloat(inceItems[i].cycleInterest);
                    
                    inceItems[i].unitInterestAmount = parseFloat(inceItems[i].unitPrice) + parseFloat(inceItems[i].cycleUnitInterest);
                    inceItems[i].interestAmount = parseFloat(inceItems[i].price) + parseFloat(inceItems[i].cycleInterest);

                    if (typeof $scope.yljDetails[dt] === 'undefined') {
                        $scope.yljDetails[dt] = [];
                    }

                    $scope.yljDetails[dt].push({
                        originalUnitPrice: inceItems[i].originalUnitPrice,
                        originalPrice: inceItems[i].originalPrice,
                        createTime: new Date(inceItems[i].createTime),
                        detailTitle: inceItems[i].detailTitle
                    });
                }
                
            }
            
            $scope.ince['total'] = total;

            $scope.inceItems = inceItems;

        }, function(err) {
            console.log(err);
        });
    };

    initYljInfo();


    $scope.actions = {
        doRefresh: function() {
            initYljInfo();
            $scope.$broadcast('scroll.refreshComplete');
        }
    }


}])


.controller('userYljBalanceItemCtrl', ['$scope', '$stateParams', function($scope, $stateParams){
    
    $scope.title = $stateParams.title;
    $scope.inceYljDetails= $stateParams.data;

    $scope.actions = {
        doRefresh: function() {
            $scope.$broadcast('scroll.refreshComplete');
        }
    }

}])
.controller('userYiBalanceCtrl', ['$scope', 'Insurance', function($scope, Insurance) {

    var initBcyljInfo = function() {
        Insurance.getBcyljInfo({}).then(function(data) {
            $scope.ince = data.results;
            var inceItems = {}, key;
            var sumProfileAmount = 0;
            var total = {
                sumProfileAmount: 0,
                sumInterest: 0
            };
            for(var i = 0; i < data.results.inceItems.length; i++) {
                key = data.results.inceItems[i].detailType;
                data.results.inceItems[i].month = new Date(data.results.inceItems[i].month);
                data.results.inceItems[i].startTime = new Date(data.results.inceItems[i].startTime);
                inceItems[ key ] = inceItems[ key ] || {list: [], key: key, title: data.results.inceItems[i].detailTitle};
                inceItems[ key ].list.push(data.results.inceItems[i]);

                if (data.results.inceItems[i].detailType.substring(data.results.inceItems[i].detailType.length -1) != '2') {
                    total.sumProfileAmount += parseFloat(data.results.inceItems[i].price);
                    total.sumInterest += parseFloat(data.results.inceItems[i].cycleInterest);
                    
                }
            }
            $scope.ince['total'] = total;

            $scope.inceItems = inceItems;

        }, function(err) {
            console.log(err);
        });
    };


    $scope.actions = {
        doRefresh: function() {
            initBcyljInfo();
            $scope.$broadcast('scroll.refreshComplete');
        }
    }

    initBcyljInfo();
}])

;
