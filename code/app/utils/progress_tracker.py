"""导入进度跟踪器"""
import time
from threading import Lock

class ProgressTracker:
    """
    全局进度跟踪器
    使用内存存储导入任务的进度信息
    """
    def __init__(self):
        self.tasks = {}  # {task_id: {status, progress, total, message, start_time}}
        self.lock = Lock()

    def create_task(self, task_id, total=0):
        """创建新任务"""
        with self.lock:
            self.tasks[task_id] = {
                'status': 'processing',  # processing, completed, failed
                'progress': 0,
                'total': total,
                'message': '准备导入...',
                'start_time': time.time()
            }

    def update_progress(self, task_id, progress, total=None, message=None):
        """更新任务进度"""
        with self.lock:
            if task_id in self.tasks:
                self.tasks[task_id]['progress'] = progress
                if total is not None:
                    self.tasks[task_id]['total'] = total
                if message is not None:
                    self.tasks[task_id]['message'] = message

    def complete_task(self, task_id, message='导入完成'):
        """标记任务完成"""
        with self.lock:
            if task_id in self.tasks:
                self.tasks[task_id]['status'] = 'completed'
                self.tasks[task_id]['message'] = message
                self.tasks[task_id]['progress'] = self.tasks[task_id]['total']

    def fail_task(self, task_id, error_message):
        """标记任务失败"""
        with self.lock:
            if task_id in self.tasks:
                self.tasks[task_id]['status'] = 'failed'
                self.tasks[task_id]['message'] = error_message

    def get_progress(self, task_id):
        """获取任务进度"""
        with self.lock:
            if task_id in self.tasks:
                task = self.tasks[task_id].copy()
                # 计算进度百分比
                if task['total'] > 0:
                    task['percentage'] = round(task['progress'] / task['total'] * 100, 2)
                else:
                    task['percentage'] = 0

                # 计算耗时和预计剩余时间
                elapsed = time.time() - task['start_time']
                task['elapsed'] = round(elapsed, 1)

                if task['progress'] > 0 and task['total'] > 0:
                    speed = task['progress'] / elapsed  # 条/秒
                    remaining_count = task['total'] - task['progress']
                    eta = remaining_count / speed if speed > 0 else 0
                    task['eta'] = round(eta, 1)
                    task['speed'] = round(speed, 1)
                else:
                    task['eta'] = 0
                    task['speed'] = 0

                return task
            return None

    def cleanup_old_tasks(self, max_age=3600):
        """清理超过指定时间的任务(默认1小时)"""
        with self.lock:
            current_time = time.time()
            expired_tasks = [
                task_id for task_id, task in self.tasks.items()
                if current_time - task['start_time'] > max_age
            ]
            for task_id in expired_tasks:
                del self.tasks[task_id]

# 全局单例
progress_tracker = ProgressTracker()
