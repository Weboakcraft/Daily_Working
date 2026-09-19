/**
 * Oakcraft Daily Working Tracker — Backend configuration.
 *
 * All sheet schemas, enums and limits live here so every module shares
 * a single source of truth. Only reference these constants from inside
 * functions (Apps Script loads files in project order).
 */

const APP = {
  NAME: 'Oakcraft Daily Working Tracker',
  VERSION: '1.1.0'
};

/** Google Sheets schema. First column of every sheet is its primary key. */
const SHEETS = {
  Employees: ['EmployeeID', 'EmployeeName', 'DepartmentID', 'Designation', 'Role', 'ManagerID', 'Email', 'Mobile',
    'JoiningDate', 'EmploymentStatus', 'Username', 'Status', 'ReportRequired', 'IsDemo', 'CreatedAt', 'UpdatedAt'],
  Credentials: ['EmployeeID', 'Username', 'PasswordHash', 'Salt', 'MustChange', 'PasswordUpdatedAt'],
  Sessions: ['SessionID', 'TokenHash', 'EmployeeID', 'CreatedAt', 'ExpiresAt', 'Revoked', 'UserAgent'],
  Departments: ['DepartmentID', 'DepartmentName', 'ManagerID', 'Status', 'Description', 'CreatedAt', 'UpdatedAt'],
  Questions: ['QuestionID', 'DepartmentID', 'QuestionKey', 'Section', 'QuestionText', 'QuestionType', 'Required', 'Options',
    'DisplayOrder', 'Validation', 'HelpText', 'DefaultValue', 'ShowIf', 'Status', 'CreatedAt', 'UpdatedAt'],
  Reports: ['ReportID', 'UniqueKey', 'EmployeeID', 'DepartmentID', 'ReportDate', 'Status', 'StartedAt', 'LastSavedAt',
    'SubmittedAt', 'FirstSubmittedAt', 'LateFlag', 'ManagerID', 'ReviewStatus', 'ManagerRemarks', 'ReopenedAt',
    'ReopenedBy', 'ReopenReason', 'TaskTotal', 'TaskCompleted', 'TaskPending', 'TaskBlocked', 'TaskCarried',
    'WorkMinutes', 'HasBlocker', 'IsDemo', 'CreatedAt', 'UpdatedAt'],
  Tasks: ['TaskID', 'ReportID', 'EmployeeID', 'DepartmentID', 'ReportDate', 'TaskTitle', 'Description', 'Category',
    'StartTime', 'EndTime', 'Duration', 'Priority', 'Status', 'RelatedType', 'RelatedEntity', 'Remarks',
    'SourceTaskID', 'CarriedToTaskID', 'CarryCount', 'DisplayOrder', 'Deleted', 'IsDemo', 'CreatedAt', 'UpdatedAt'],
  Responses: ['ResponseID', 'ReportID', 'QuestionID', 'EmployeeID', 'DepartmentID', 'ReportDate', 'QuestionText',
    'Answer', 'IsDemo', 'CreatedAt', 'UpdatedAt'],
  Remarks: ['RemarkID', 'ReportID', 'AuthorID', 'Comment', 'FollowUpRequired', 'Priority', 'ReviewStatus', 'IsDemo', 'CreatedAt'],
  FollowUps: ['FollowUpID', 'ReportID', 'TaskID', 'EmployeeID', 'DepartmentID', 'OwnerID', 'Title', 'Description',
    'Priority', 'DueDate', 'Status', 'Source', 'Resolution', 'CreatedBy', 'IsDemo', 'CreatedAt', 'UpdatedAt', 'ResolvedAt'],
  Settings: ['SettingKey', 'SettingValue', 'Description', 'UpdatedAt'],
  AuditLog: ['LogID', 'UserID', 'Action', 'Entity', 'EntityID', 'OldValue', 'NewValue', 'Timestamp', 'Metadata'],
  ErrorLog: ['ErrorID', 'Timestamp', 'UserID', 'Action', 'Message', 'Stack', 'Payload']
};

/** Small, frequently-read tables are cached in CacheService. */
const CACHED_TABLES = { Employees: true, Departments: true, Questions: true, Settings: true };

const ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE'];
const RECORD_STATUS = ['Active', 'Inactive'];
const EMPLOYMENT_STATUS = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Probation', 'Notice period', 'Exited'];

const REPORT_STATUS = {
  NOT_STARTED: 'NOT STARTED',
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  LATE: 'LATE',
  REOPENED: 'REOPENED'
};

const TASK_STATUSES = ['COMPLETED', 'IN PROGRESS', 'PENDING', 'BLOCKED', 'CARRIED FORWARD', 'CANCELLED'];
const OPEN_TASK_STATUSES = ['IN PROGRESS', 'PENDING', 'BLOCKED', 'CARRIED FORWARD'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const REVIEW_STATUSES = ['NOT REVIEWED', 'REVIEWED', 'FOLLOW-UP REQUIRED', 'RESOLVED'];
const FOLLOWUP_STATUSES = ['OPEN', 'IN PROGRESS', 'RESOLVED', 'CLOSED'];
const FOLLOWUP_SOURCES = ['BLOCKER', 'TASK', 'REMARK', 'MANUAL'];
const RELATED_TYPES = ['CUSTOMER', 'ORDER', 'PROJECT', 'TENDER', 'VENDOR', 'PRODUCT', 'OTHER'];

const QUESTION_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'DECIMAL', 'DROPDOWN', 'MULTI_SELECT', 'CHECKBOX',
  'RADIO', 'DATE', 'TIME', 'RATING', 'YES_NO'];
const OPTION_TYPES = ['DROPDOWN', 'MULTI_SELECT', 'RADIO'];
const MULTI_VALUE_TYPES = ['MULTI_SELECT', 'CHECKBOX'];

/** Report sections — drive form steps and the report detail layout. */
const QUESTION_SECTIONS = ['WORK_SUMMARY', 'COMPLETED', 'PENDING', 'CARRY_FORWARD', 'KPI', 'BLOCKERS', 'FOLLOWUPS',
  'MEETINGS', 'TOMORROW_PLAN', 'NOTES'];

const COMMON_DEPARTMENT_ID = 'ALL';

const LIMITS = {
  PAGE_SIZE_MAX: 200,
  TASKS_PER_REPORT: 100,
  TEXT: 5000,
  SHORT: 200,
  CARRY_LOOKBACK_DAYS: 45,
  RANGE_MAX_DAYS: 400,
  NOT_STARTED_MAX_DAYS: 62,
  EXPORT_MAX_ROWS: 20000,
  HASH_ITERATIONS: 400,
  RATE_LIMIT_PER_MIN: 240,
  // Six hours is the longest CacheService keeps anything. Holding sessions that long means a
  // signed-in person almost never makes the server scan the Sessions sheet to prove who they are.
  SESSION_CACHE_SEC: 21600,
  IDEMPOTENCY_SEC: 600,
  // Waiting 25 seconds for the shared write lock meant a busy evening queued everybody behind one
  // slow save and then timed them all out together. Failing sooner lets the client retry with a
  // backoff, which drains the queue instead of deepening it.
  LOCK_WAIT_MS: 10000,
  SESSION_PRUNE_MAX: 500
};
