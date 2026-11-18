/** Runtime configuration is distinct from a successful collection or a healthy worker heartbeat. */
export const monitoringRuntimeActive=()=>process.env.REGPILOT_MONITORING_ENABLED==='true'&&process.env.REGPILOT_AUTOMATION_ENABLED==='true'&&(process.env.REGPILOT_CRON_ENABLED==='true'||process.env.REGPILOT_WORKER_ENABLED==='true');
