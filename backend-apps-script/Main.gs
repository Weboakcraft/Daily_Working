function getRoutes() {
  const ALL = null;
  const MGMT = [ 'ADMIN', 'MANAGER' ];
  const ADMIN = [ 'ADMIN' ];
  return {
    login: {
      fn: apiLogin,
      public: true
    },
    logout: {
      fn: apiLogout,
      roles: ALL,
      allowMustChange: true
    },
    me: {
      fn: apiMe,
      roles: ALL,
      allowMustChange: true
    },
    changePassword: {
      fn: apiChangePassword,
      roles: ALL,
      allowMustChange: true
    },
    batch: {
      fn: apiBatch,
      roles: ALL
    },
    getEmployees: {
      fn: apiGetEmployees,
      roles: MGMT
    },
    getEmployeeDirectory: {
      fn: apiGetEmployeeDirectory,
      roles: MGMT
    },
    getEmployee: {
      fn: apiGetEmployee,
      roles: ALL
    },
    saveEmployee: {
      fn: apiSaveEmployee,
      roles: ADMIN
    },
    updateEmployee: {
      fn: apiUpdateEmployee,
      roles: ADMIN
    },
    setEmployeeStatus: {
      fn: apiSetEmployeeStatus,
      roles: ADMIN
    },
    resetPassword: {
      fn: apiResetPassword,
      roles: ADMIN
    },
    importEmployees: {
      fn: apiImportEmployees,
      roles: ADMIN
    },
    getDepartments: {
      fn: apiGetDepartments,
      roles: ALL
    },
    saveDepartment: {
      fn: apiSaveDepartment,
      roles: ADMIN
    },
    getQuestions: {
      fn: apiGetQuestions,
      roles: ALL
    },
    saveQuestion: {
      fn: apiSaveQuestion,
      roles: ADMIN
    },
    updateQuestion: {
      fn: apiUpdateQuestion,
      roles: ADMIN
    },
    reorderQuestions: {
      fn: apiReorderQuestions,
      roles: ADMIN
    },
    getTodayReport: {
      fn: apiGetTodayReport,
      roles: ALL
    },
    saveDraft: {
      fn: apiSaveDraft,
      roles: ALL,
      keepsCache: true
    },
    submitReport: {
      fn: apiSubmitReport,
      roles: ALL
    },
    reopenReport: {
      fn: apiReopenReport,
      roles: ADMIN
    },
    getReport: {
      fn: apiGetReport,
      roles: ALL
    },
    getReports: {
      fn: apiGetReports,
      roles: ALL
    },
    saveManagerRemark: {
      fn: apiSaveManagerRemark,
      roles: MGMT
    },
    getTasks: {
      fn: apiGetTasks,
      roles: ALL
    },
    saveTask: {
      fn: apiSaveTask,
      roles: ALL
    },
    updateTask: {
      fn: apiUpdateTask,
      roles: ALL
    },
    getFollowUps: {
      fn: apiGetFollowUps,
      roles: ALL
    },
    saveFollowUp: {
      fn: apiSaveFollowUp,
      roles: ALL
    },
    getDashboardData: {
      fn: apiGetDashboardData,
      roles: MGMT
    },
    getMyDashboard: {
      fn: apiGetMyDashboard,
      roles: ALL
    },
    getWeeklyMis: {
      fn: apiGetWeeklyMis,
      roles: ALL
    },
    getEmployeeAnalytics: {
      fn: apiGetEmployeeAnalytics,
      roles: ALL
    },
    getDepartmentAnalytics: {
      fn: apiGetDepartmentAnalytics,
      roles: MGMT
    },
    search: {
      fn: apiSearch,
      roles: ALL
    },
    exportReport: {
      fn: apiExportReport,
      roles: MGMT
    },
    getSettings: {
      fn: apiGetSettings,
      roles: ALL
    },
    saveSettings: {
      fn: apiSaveSettings,
      roles: ADMIN
    },
    getAuditLogs: {
      fn: apiGetAuditLogs,
      roles: ADMIN
    },
    getErrorLogs: {
      fn: apiGetErrorLogs,
      roles: ADMIN
    },
    installTriggers: {
      fn: apiInstallTriggers,
      roles: ADMIN
    },
    sendTestNotification: {
      fn: apiSendTestNotification,
      roles: ADMIN
    }
  };
}


var BATCHABLE = {
  me: true,
  getEmployees: true,
  getEmployeeDirectory: true,
  getEmployee: true,
  getDepartments: true,
  getQuestions: true,
  getTodayReport: true,
  getReport: true,
  getReports: true,
  getTasks: true,
  getFollowUps: true,
  getDashboardData: true,
  getMyDashboard: true,
  getEmployeeAnalytics: true,
  getWeeklyMis: true,
  getDepartmentAnalytics: true,
  search: true,
  getSettings: true,
  getAuditLogs: true,
  getErrorLogs: true
};


function apiBatch(p, user, meta) {
  const calls = Array.isArray(p.calls) ? p.calls : [];
  assert(calls.length >= 1 && calls.length <= 8, 'VALIDATION', 'A batch holds between 1 and 8 calls.');
  const routes = getRoutes();
  return calls.map(function(c) {
    const action = c && c.action;
    try {
      const route = BATCHABLE[action] && Object.prototype.hasOwnProperty.call(routes, action) ? routes[action] : null;
      if (!route) {
        throw appError('NOT_FOUND', 'Unknown action.');
      }
      if (user.mustChangePassword && !route.allowMustChange) {
        throw appError('PASSWORD_CHANGE_REQUIRED', 'Please change your password to continue.');
      }
      if (route.roles && route.roles.indexOf(user.role) < 0) {
        throw appError('FORBIDDEN', 'You do not have permission to do this.');
      }
      const payload = c.payload && typeof c.payload === 'object' ? c.payload : {};
      const data = route.fn(payload, user, meta || {});
      return {
        ok: true,
        data: data === undefined ? null : data
      };
    } catch (err) {
      return errorResponse(err, {
        action: action,
        payload: c && c.payload
      }, user);
    }
  });
}


function doGet() {
  return jsonOut({
    ok: true,
    data: {
      app: APP.NAME,
      version: APP.VERSION,
      status: 'running',
      time: nowIso()
    }
  });
}


function doPost(e) {
  let req = {};
  let user = null;
  const cache = CacheService.getScriptCache();
  let idemKey = '';
  try {
    try {
      req = JSON.parse(e && e.postData && e.postData.contents || '{}');
    } catch (parseErr) {
      throw appError('BAD_REQUEST', 'Request could not be read.');
    }
    const routes = getRoutes();
    const route = Object.prototype.hasOwnProperty.call(routes, req.action) ? routes[req.action] : null;
    if (!route) {
      throw appError('NOT_FOUND', 'Unknown action.');
    }
    REQUEST_META = {
      action: req.action,
      ua: cleanText(req.meta && req.meta.ua, 160),
      app: cleanText(req.meta && req.meta.app, 20)
    };
    if (!route.public) {
      user = authenticate(req.token);
      enforceRateLimit(user);
      if (user.mustChangePassword && !route.allowMustChange) {
        throw appError('PASSWORD_CHANGE_REQUIRED', 'Please change your password to continue.');
      }
      if (route.roles && route.roles.indexOf(user.role) < 0) {
        throw appError('FORBIDDEN', 'You do not have permission to do this.');
      }
    }
    if (req.requestId && /^[A-Za-z0-9-]{8,64}$/.test(String(req.requestId)) && user) {
      idemKey = 'req:' + user.id + ':' + req.requestId;
      const prior = cache.get(idemKey);
      if (prior === '__PENDING__') {
        throw appError('IN_PROGRESS', 'Your previous request is still being processed. Please wait.');
      }
      if (prior) {
        return ContentService.createTextOutput(prior).setMimeType(ContentService.MimeType.JSON);
      }
      cache.put(idemKey, '__PENDING__', 120);
    }
    const payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
    const data = route.fn(payload, user, req.meta || {});
    flushAudit();
    if (req.requestId && !route.keepsCache) {
      ocBumpCache_();
    }
    const body = JSON.stringify({
      ok: true,
      data: data === undefined ? null : data
    });
    if (idemKey) {
      if (body.length < 90000) {
        cache.put(idemKey, body, LIMITS.IDEMPOTENCY_SEC);
      } else {
        cache.remove(idemKey);
      }
    }
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    if (idemKey) {
      try {
        cache.remove(idemKey);
      } catch (x) {}
    }
    AUDIT_BUFFER = [];
    return jsonOut(errorResponse(err, req, user));
  }
}


function errorResponse(err, req, user) {
  if (err && err.appCode) {
    const out = {
      code: err.appCode,
      message: err.message
    };
    if (err.details && err.details.fieldErrors) {
      out.fieldErrors = err.details.fieldErrors;
    }
    if (err.details && err.details.taskErrors) {
      out.taskErrors = err.details.taskErrors;
    }
    if (err.appCode === 'SETUP_REQUIRED' && (!user || user.role !== 'ADMIN')) {
      out.message = 'The system is not ready yet. Please contact the admin.';
    }
    return {
      ok: false,
      error: out
    };
  }
  const errorId = logError(err, req && req.action, user, req && req.payload);
  const out = {
    code: 'SERVER_ERROR',
    message: 'Something went wrong. Please try again.',
    errorId: errorId
  };
  if (user && user.role === 'ADMIN') {
    out.details = String(err && err.message || err);
  }
  return {
    ok: false,
    error: out
  };
}


function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Oakcraft').addItem('1. Set up / repair database', 'setupOakcraftSystem').addItem('2. Load demo data (development only)', 'seedDemoData').addItem('3. Remove demo data', 'removeDemoData').addSeparator().addItem('Apply the reporting deadline to this Sheet', 'applyReportingWindow').addItem('Install scheduled jobs (reminders)', 'installTriggers').addItem('Apply manual edits to the app now', 'refreshAppCache').addToUi();
  } catch (e) {}
}
