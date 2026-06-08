/*
 * Electric Vehicle Battery Management System (BMS)
 * Real-Time Scheduler Simulator for Linux / Ubuntu
 *
 * Features:
 *   - POSIX pthread task workers
 *   - POSIX pipe logger
 *   - Preemptive tick scheduler
 *   - RMS, EDF, and fixed-priority modes
 *   - Animated terminal dashboard with battery and Gantt views
 *
 * Build:
 *   g++ -std=c++17 -Wall -Wextra -O2 -o bms_animated main.cpp -lpthread -lm
 */

#include <algorithm>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <unistd.h>
#include <vector>
#include <pthread.h>

using namespace std;

static const int TICK_MS = 10;
static const int TASK_COUNT = 5;

enum class Algorithm {
    RMS,
    EDF,
    PRIORITY
};

struct Config {
    Algorithm algorithm = Algorithm::RMS;
    int duration_ms = 2000;
    bool animate = false;
    bool stress = false;
    bool color = true;
    bool quiet = false;
    int frame_delay_ms = 90;
};

struct TaskSpec {
    int id;
    string name;
    string short_name;
    int period_ms;
    int exec_ms;
    int deadline_ms;
    int priority;
    char symbol;
};

struct TaskStats {
    int released = 0;
    int completed = 0;
    int missed = 0;
    int preemptions = 0;
    long long turnaround_sum = 0;
    long long waiting_sum = 0;
};

struct Job {
    int id = 0;
    int task_index = 0;
    int release_time = 0;
    int abs_deadline = 0;
    int remaining_ms = 0;
    int total_exec_ms = 0;
    int first_start_ms = -1;
    bool started = false;
    bool miss_reported = false;
};

struct BatteryState {
    double soc = 78.0;
    double pack_voltage = 389.5;
    double temperature_c = 32.0;
    double cell_spread_v = 0.041;
    int logger_samples = 0;
    bool safety_ok = true;
};

struct WorkerControl {
    pthread_mutex_t mutex;
    pthread_cond_t wake_cv;
    pthread_cond_t done_cv;
    bool stop;
    bool run;
    bool done;
    int quantum_ms;
    int job_id;

    WorkerControl()
        : stop(false), run(false), done(false), quantum_ms(0), job_id(0) {
        pthread_mutex_init(&mutex, nullptr);
        pthread_cond_init(&wake_cv, nullptr);
        pthread_cond_init(&done_cv, nullptr);
    }
};

struct WorkerArg {
    int task_index;
};

struct SchedulerArgs {
    Config cfg;
};

static vector<TaskSpec> g_tasks;
static vector<TaskStats> g_stats;
static BatteryState g_battery;
static WorkerControl g_workers[TASK_COUNT];
static WorkerArg g_worker_args[TASK_COUNT];
static int g_log_pipe[2] = {-1, -1};
static pthread_mutex_t g_recent_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t g_print_mutex = PTHREAD_MUTEX_INITIALIZER;
static vector<string> g_recent_events;
static bool g_use_color = true;
static bool g_animate = false;
static bool g_quiet = false;

static string clr_reset() { return g_use_color ? "\033[0m" : ""; }
static string clr_bold() { return g_use_color ? "\033[1m" : ""; }
static string clr_dim() { return g_use_color ? "\033[2m" : ""; }
static string clr_red() { return g_use_color ? "\033[1;31m" : ""; }
static string clr_green() { return g_use_color ? "\033[1;32m" : ""; }
static string clr_yellow() { return g_use_color ? "\033[1;33m" : ""; }

static string task_color(int index) {
    if (!g_use_color) return "";
    static const char *colors[] = {
        "\033[1;31m", "\033[1;33m", "\033[1;36m", "\033[1;32m", "\033[1;35m"
    };
    return colors[index % TASK_COUNT];
}

static string algorithm_name(Algorithm algo) {
    switch (algo) {
        case Algorithm::RMS:
            return "Rate Monotonic Scheduling (RMS)";
        case Algorithm::EDF:
            return "Earliest Deadline First (EDF)";
        case Algorithm::PRIORITY:
            return "Fixed Priority Scheduling";
    }
    return "Unknown";
}

static vector<TaskSpec> make_tasks(bool stress) {
    if (!stress) {
        return {
            {0, "Voltage Monitor",     "VOLT", 100,  10,  100, 1, 'V'},
            {1, "Temperature Sensor",  "TEMP", 200,  20,  200, 2, 'T'},
            {2, "SoC Calculator",      "SOC ", 500,  40,  500, 3, 'S'},
            {3, "Cell Balancer",       "BAL ",1000,  60, 1000, 4, 'B'},
            {4, "Diagnostic Logger",   "LOG ",2000,  80, 2000, 5, 'L'}
        };
    }

    return {
        {0, "Voltage Monitor",     "VOLT", 100,  30,  100, 1, 'V'},
        {1, "Temperature Sensor",  "TEMP", 200,  70,  200, 2, 'T'},
        {2, "SoC Calculator",      "SOC ", 500, 150,  500, 3, 'S'},
        {3, "Cell Balancer",       "BAL ",1000, 330, 1000, 4, 'B'},
        {4, "Diagnostic Logger",   "LOG ",2000, 520, 2000, 5, 'L'}
    };
}

static string bar(double value, double max_value, int width, char fill = '#') {
    if (max_value <= 0.0) max_value = 1.0;
    double ratio = max(0.0, min(1.0, value / max_value));
    int filled = static_cast<int>(round(ratio * width));
    return "[" + string(filled, fill) + string(width - filled, '.') + "]";
}

static string fixed_1(double value) {
    ostringstream out;
    out << fixed << setprecision(1) << value;
    return out.str();
}

static string fixed_2(double value) {
    ostringstream out;
    out << fixed << setprecision(2) << value;
    return out.str();
}

static string event_line(int time_ms, const string &type, const TaskSpec *task, const string &details) {
    ostringstream out;
    out << "[T=" << setw(5) << time_ms << " ms] "
        << left << setw(9) << type;
    if (task) {
        out << left << setw(22) << task->name;
    } else {
        out << left << setw(22) << "Scheduler";
    }
    out << details;
    return out.str();
}

static void remember_event(const string &line) {
    pthread_mutex_lock(&g_recent_mutex);
    g_recent_events.push_back(line);
    if (g_recent_events.size() > 8) {
        g_recent_events.erase(g_recent_events.begin());
    }
    pthread_mutex_unlock(&g_recent_mutex);
}

static void emit_event(int time_ms, const string &type, int task_index, const string &details) {
    const TaskSpec *task = (task_index >= 0) ? &g_tasks[task_index] : nullptr;
    string plain = event_line(time_ms, type, task, details);
    remember_event(plain);

    if (g_log_pipe[1] >= 0) {
        string line = plain + "\n";
        ssize_t bytes_written = write(g_log_pipe[1], line.c_str(), line.size());
        (void)bytes_written;
    }

    if (!g_animate && !g_quiet) {
        pthread_mutex_lock(&g_print_mutex);
        if (task_index >= 0) {
            cout << task_color(task_index) << plain << clr_reset() << "\n";
        } else {
            cout << clr_dim() << plain << clr_reset() << "\n";
        }
        pthread_mutex_unlock(&g_print_mutex);
    }
}

static void *logger_thread(void *) {
    ofstream log_file("bms_log.txt", ios::out | ios::trunc);
    log_file << "EV Battery Management System - scheduler event log\n";
    log_file << "=================================================\n\n";

    char buffer[512];
    string pending;
    while (true) {
        ssize_t n = read(g_log_pipe[0], buffer, sizeof(buffer));
        if (n <= 0) break;
        pending.append(buffer, buffer + n);
        size_t newline_pos = 0;
        while ((newline_pos = pending.find('\n')) != string::npos) {
            log_file << pending.substr(0, newline_pos) << "\n";
            pending.erase(0, newline_pos + 1);
        }
    }
    if (!pending.empty()) log_file << pending << "\n";
    return nullptr;
}

static void *task_worker_thread(void *arg) {
    int task_index = static_cast<WorkerArg *>(arg)->task_index;
    WorkerControl &ctrl = g_workers[task_index];

    while (true) {
        pthread_mutex_lock(&ctrl.mutex);
        while (!ctrl.run && !ctrl.stop) {
            pthread_cond_wait(&ctrl.wake_cv, &ctrl.mutex);
        }
        if (ctrl.stop) {
            pthread_mutex_unlock(&ctrl.mutex);
            break;
        }

        ctrl.run = false;
        int quantum = ctrl.quantum_ms;
        pthread_mutex_unlock(&ctrl.mutex);

        // The scheduler owns simulated time. Workers wake, perform a tiny
        // POSIX-thread-controlled quantum, and acknowledge completion.
        if (quantum > 0) {
            usleep(1000);
        }

        pthread_mutex_lock(&ctrl.mutex);
        ctrl.done = true;
        pthread_cond_signal(&ctrl.done_cv);
        pthread_mutex_unlock(&ctrl.mutex);
    }

    return nullptr;
}

static void dispatch_quantum(int task_index, int job_id, int quantum_ms) {
    WorkerControl &ctrl = g_workers[task_index];

    pthread_mutex_lock(&ctrl.mutex);
    ctrl.quantum_ms = quantum_ms;
    ctrl.job_id = job_id;
    ctrl.done = false;
    ctrl.run = true;
    pthread_cond_signal(&ctrl.wake_cv);
    while (!ctrl.done) {
        pthread_cond_wait(&ctrl.done_cv, &ctrl.mutex);
    }
    pthread_mutex_unlock(&ctrl.mutex);
}

static void stop_workers(pthread_t worker_threads[]) {
    for (int i = 0; i < TASK_COUNT; ++i) {
        WorkerControl &ctrl = g_workers[i];
        pthread_mutex_lock(&ctrl.mutex);
        ctrl.stop = true;
        pthread_cond_signal(&ctrl.wake_cv);
        pthread_mutex_unlock(&ctrl.mutex);
    }
    for (int i = 0; i < TASK_COUNT; ++i) {
        pthread_join(worker_threads[i], nullptr);
    }
}

static bool better_job(const Job &a, const Job &b, Algorithm algo) {
    const TaskSpec &ta = g_tasks[a.task_index];
    const TaskSpec &tb = g_tasks[b.task_index];

    if (algo == Algorithm::EDF && a.abs_deadline != b.abs_deadline) {
        return a.abs_deadline < b.abs_deadline;
    }
    if ((algo == Algorithm::RMS || algo == Algorithm::PRIORITY) &&
        ta.priority != tb.priority) {
        return ta.priority < tb.priority;
    }
    if (a.release_time != b.release_time) return a.release_time < b.release_time;
    return a.id < b.id;
}

static int select_job_index(const vector<Job> &ready, Algorithm algo) {
    int best = 0;
    for (int i = 1; i < static_cast<int>(ready.size()); ++i) {
        if (better_job(ready[i], ready[best], algo)) best = i;
    }
    return best;
}

static void update_battery_after_job(const TaskSpec &task, int finish_time_ms, bool stress) {
    double seconds = finish_time_ms / 1000.0;
    double load = stress ? 1.65 : 1.0;

    if (task.short_name == "VOLT") {
        g_battery.pack_voltage = 389.5 + 3.5 * sin(seconds * 2.4);
        g_battery.cell_spread_v = max(0.012, 0.040 + 0.018 * sin(seconds * 1.9));
    } else if (task.short_name == "TEMP") {
        g_battery.temperature_c = 32.0 + load * (2.8 + 1.7 * sin(seconds * 1.3));
    } else if (task.short_name == "SOC ") {
        g_battery.soc = max(0.0, g_battery.soc - (stress ? 0.16 : 0.07));
    } else if (task.short_name == "BAL ") {
        g_battery.cell_spread_v = max(0.006, g_battery.cell_spread_v * 0.72);
    } else if (task.short_name == "LOG ") {
        g_battery.logger_samples += 1;
    }

    g_battery.safety_ok =
        g_battery.temperature_c < 55.0 &&
        g_battery.cell_spread_v < 0.150 &&
        g_battery.pack_voltage > 330.0 &&
        g_battery.soc > 5.0;
}

static void print_header(const Config &cfg) {
    cout << clr_bold();
    cout << "+==============================================================================+\n";
    cout << "|       EV Battery Management System - Real-Time Scheduler Simulator            |\n";
    cout << "|       Scenario 2: Electric Vehicle BMS | Linux POSIX Threads + Pipes          |\n";
    cout << "+==============================================================================+\n";
    cout << clr_reset();
    cout << "Algorithm : " << algorithm_name(cfg.algorithm) << "\n";
    cout << "Mode      : " << (cfg.stress ? "stress test / overload" : "normal safe load")
         << " | Duration: " << cfg.duration_ms << " ms\n\n";
}

static void print_task_table() {
    cout << clr_bold() << "Task set\n" << clr_reset();
    cout << left << setw(4) << "ID"
         << setw(23) << "Task"
         << setw(12) << "Period"
         << setw(12) << "Exec"
         << setw(12) << "Deadline"
         << setw(10) << "Priority"
         << "Util\n";
    cout << string(80, '-') << "\n";

    double total_util = 0.0;
    for (const TaskSpec &t : g_tasks) {
        double util = 100.0 * t.exec_ms / t.period_ms;
        total_util += util;
        cout << task_color(t.id)
             << left << setw(4) << t.id
             << setw(23) << t.name
             << setw(12) << (to_string(t.period_ms) + " ms")
             << setw(12) << (to_string(t.exec_ms) + " ms")
             << setw(12) << (to_string(t.deadline_ms) + " ms")
             << setw(10) << t.priority
             << fixed << setprecision(1) << util << "%"
             << clr_reset() << "\n";
    }
    cout << string(80, '-') << "\n";
    cout << "Total CPU utilization demand: " << fixed << setprecision(1) << total_util << "%\n\n";
}

static void print_rms_analysis() {
    int n = static_cast<int>(g_tasks.size());
    double utilization = 0.0;
    for (const TaskSpec &t : g_tasks) {
        utilization += static_cast<double>(t.exec_ms) / t.period_ms;
    }
    double bound = n * (pow(2.0, 1.0 / n) - 1.0);

    cout << clr_bold() << "RMS schedulability check\n" << clr_reset();
    cout << "U = " << fixed << setprecision(4) << utilization
         << " | Liu-Layland bound = " << fixed << setprecision(4) << bound << "\n";
    if (utilization <= bound) {
        cout << clr_green() << "Result: schedulable under RMS utilization bound.\n\n" << clr_reset();
    } else {
        cout << clr_yellow()
             << "Result: above RMS bound. Simulation will reveal deadline behavior.\n\n"
             << clr_reset();
    }
}

static string ready_queue_text(const vector<Job> &ready, Algorithm algo) {
    if (ready.empty()) return "empty";

    vector<Job> sorted = ready;
    sort(sorted.begin(), sorted.end(), [algo](const Job &a, const Job &b) {
        return better_job(a, b, algo);
    });

    ostringstream out;
    int shown = min(4, static_cast<int>(sorted.size()));
    for (int i = 0; i < shown; ++i) {
        const Job &job = sorted[i];
        const TaskSpec &task = g_tasks[job.task_index];
        if (i) out << " | ";
        out << task.short_name << " d=" << job.abs_deadline
            << " rem=" << job.remaining_ms;
    }
    if (static_cast<int>(sorted.size()) > shown) out << " | ...";
    return out.str();
}

static string timeline_window(const string &line, int current_slot, int width) {
    int end = min(static_cast<int>(line.size()), max(width, current_slot + 1));
    end = min(static_cast<int>(line.size()), current_slot + 1);
    int start = max(0, end - width);
    string view = line.substr(start, end - start);
    if (static_cast<int>(view.size()) < width) {
        view = string(width - view.size(), '.') + view;
    }
    return view;
}

static void render_dashboard(
    const Config &cfg,
    int sim_time_ms,
    int active_task,
    const Job *active_job,
    const vector<Job> &ready,
    const vector<string> &timeline,
    int busy_ms
) {
    if (!g_animate) return;

    int duration = max(1, cfg.duration_ms);
    int current_slot = max(0, min(static_cast<int>(timeline[0].size()) - 1, sim_time_ms / TICK_MS));
    double cpu_util = 100.0 * busy_ms / duration;

    cout << "\033[2J\033[H";
    cout << clr_bold()
         << "+==============================================================================+\n"
         << "| EV BMS LIVE DASHBOARD                                                        |\n"
         << "+==============================================================================+\n"
         << clr_reset();

    cout << "Algorithm : " << algorithm_name(cfg.algorithm)
         << " | t=" << setw(4) << sim_time_ms << "/" << duration << " ms"
         << " | " << (cfg.stress ? "stress load" : "normal load") << "\n";

    cout << "Safety    : ";
    if (g_battery.safety_ok) {
        cout << clr_green() << "OK" << clr_reset();
    } else {
        cout << clr_red() << "ATTENTION" << clr_reset();
    }
    cout << " | SoC " << setw(5) << fixed_1(g_battery.soc) << "% "
         << bar(g_battery.soc, 100.0, 24)
         << " | Temp " << setw(5) << fixed_1(g_battery.temperature_c) << " C"
         << " | Pack " << fixed_1(g_battery.pack_voltage) << " V\n";

    cout << "Cells     : spread " << fixed_2(g_battery.cell_spread_v) << " V "
         << bar(max(0.0, 0.15 - g_battery.cell_spread_v), 0.15, 24)
         << " | logger samples " << g_battery.logger_samples << "\n\n";

    cout << clr_bold() << "CPU core  : " << clr_reset();
    if (active_task >= 0 && active_job) {
        cout << task_color(active_task) << left << setw(22) << g_tasks[active_task].name
             << clr_reset()
             << " job#" << active_job->id
             << " rem=" << setw(3) << active_job->remaining_ms << " ms"
             << " deadline=" << active_job->abs_deadline << " ms\n";
    } else {
        cout << clr_dim() << "idle" << clr_reset() << "\n";
    }

    cout << "Ready     : " << ready_queue_text(ready, cfg.algorithm) << "\n";
    cout << "CPU util  : " << fixed_1(cpu_util) << "% "
         << bar(cpu_util, 100.0, 24) << "\n\n";

    cout << clr_bold() << "Gantt timeline, most recent 70 ticks (each tick = 10 ms)\n" << clr_reset();
    for (int i = 0; i < TASK_COUNT; ++i) {
        cout << task_color(i) << g_tasks[i].short_name << " "
             << timeline_window(timeline[i], current_slot, 70)
             << clr_reset() << "\n";
    }

    cout << "\n" << clr_bold() << "Recent events\n" << clr_reset();
    pthread_mutex_lock(&g_recent_mutex);
    for (const string &event : g_recent_events) {
        cout << "  " << event << "\n";
    }
    pthread_mutex_unlock(&g_recent_mutex);
    cout.flush();
}

static void fill_timeline(vector<string> &timeline, int task_index, int start_ms, int end_ms) {
    int start_slot = start_ms / TICK_MS;
    int end_slot = (end_ms + TICK_MS - 1) / TICK_MS;
    end_slot = min(end_slot, static_cast<int>(timeline[task_index].size()));

    for (int slot = start_slot; slot < end_slot; ++slot) {
        timeline[task_index][slot] = g_tasks[task_index].symbol;
    }
}

static void *scheduler_thread(void *arg) {
    Config cfg = static_cast<SchedulerArgs *>(arg)->cfg;
    vector<Job> ready;
    vector<int> next_release(TASK_COUNT, 0);
    int total_slots = max(1, (cfg.duration_ms + TICK_MS - 1) / TICK_MS);
    vector<string> timeline(TASK_COUNT, string(total_slots, '.'));
    int now_ms = 0;
    int job_sequence = 1;
    int busy_ms = 0;
    int active_job_id = -1;
    int active_task = -1;

    if (!cfg.animate && !cfg.quiet) {
        print_header(cfg);
        print_task_table();
        if (cfg.algorithm == Algorithm::RMS) print_rms_analysis();
        cout << clr_bold() << "Execution log\n" << clr_reset();
    } else if (cfg.animate) {
        cout << "\033[?25l";
    }

    while (now_ms < cfg.duration_ms) {
        for (int i = 0; i < TASK_COUNT; ++i) {
            while (next_release[i] <= now_ms && next_release[i] < cfg.duration_ms) {
                Job job;
                job.id = job_sequence++;
                job.task_index = i;
                job.release_time = next_release[i];
                job.abs_deadline = next_release[i] + g_tasks[i].deadline_ms;
                job.remaining_ms = g_tasks[i].exec_ms;
                job.total_exec_ms = g_tasks[i].exec_ms;
                ready.push_back(job);
                g_stats[i].released++;

                ostringstream details;
                details << "deadline=" << job.abs_deadline
                        << " ms, exec=" << job.total_exec_ms << " ms";
                emit_event(now_ms, "RELEASE", i, details.str());
                next_release[i] += g_tasks[i].period_ms;
            }
        }

        for (Job &job : ready) {
            if (!job.miss_reported && now_ms >= job.abs_deadline && job.remaining_ms > 0) {
                job.miss_reported = true;
                g_stats[job.task_index].missed++;
                emit_event(now_ms, "MISS", job.task_index, "deadline crossed before completion");
            }
        }

        if (ready.empty()) {
            active_job_id = -1;
            active_task = -1;
            int step = min(TICK_MS, cfg.duration_ms - now_ms);
            now_ms += step;
            render_dashboard(cfg, now_ms, -1, nullptr, ready, timeline, busy_ms);
            if (cfg.animate && cfg.frame_delay_ms > 0) usleep(cfg.frame_delay_ms * 1000);
            continue;
        }

        int selected_index = select_job_index(ready, cfg.algorithm);
        Job &job = ready[selected_index];
        const TaskSpec &task = g_tasks[job.task_index];

        if (active_job_id >= 0 && active_job_id != job.id) {
            auto prev = find_if(ready.begin(), ready.end(), [active_job_id](const Job &candidate) {
                return candidate.id == active_job_id && candidate.remaining_ms > 0;
            });
            if (prev != ready.end()) {
                g_stats[prev->task_index].preemptions++;
                emit_event(now_ms, "PREEMPT", prev->task_index,
                           "CPU taken by " + task.name);
            }
        }

        if (!job.started) {
            job.started = true;
            job.first_start_ms = now_ms;
            emit_event(now_ms, "START", job.task_index,
                       "job#" + to_string(job.id) + " running on CPU");
        } else if (active_job_id != job.id) {
            emit_event(now_ms, "RESUME", job.task_index,
                       "job#" + to_string(job.id) + " continues");
        }

        int start_ms = now_ms;
        int quantum_ms = min(TICK_MS, job.remaining_ms);
        quantum_ms = min(quantum_ms, cfg.duration_ms - now_ms);
        dispatch_quantum(job.task_index, job.id, quantum_ms);

        job.remaining_ms -= quantum_ms;
        now_ms += quantum_ms;
        busy_ms += quantum_ms;
        active_job_id = job.id;
        active_task = job.task_index;
        fill_timeline(timeline, job.task_index, start_ms, now_ms);

        render_dashboard(cfg, now_ms, active_task, &job, ready, timeline, busy_ms);
        if (cfg.animate && cfg.frame_delay_ms > 0) usleep(cfg.frame_delay_ms * 1000);

        if (job.remaining_ms == 0) {
            bool missed = now_ms > job.abs_deadline;
            if (missed && !job.miss_reported) {
                job.miss_reported = true;
                g_stats[job.task_index].missed++;
            }

            int turnaround = now_ms - job.release_time;
            int waiting = turnaround - job.total_exec_ms;
            g_stats[job.task_index].completed++;
            g_stats[job.task_index].turnaround_sum += turnaround;
            g_stats[job.task_index].waiting_sum += max(0, waiting);
            update_battery_after_job(task, now_ms, cfg.stress);

            ostringstream details;
            if (missed) {
                details << "job#" << job.id << " late by "
                        << (now_ms - job.abs_deadline) << " ms";
            } else {
                details << "job#" << job.id << " deadline met, slack "
                        << (job.abs_deadline - now_ms) << " ms";
            }
            emit_event(now_ms, missed ? "FINISH-X" : "FINISH", job.task_index, details.str());

            ready.erase(ready.begin() + selected_index);
            active_job_id = -1;
            active_task = -1;
        }
    }

    for (Job &job : ready) {
        if (!job.miss_reported && cfg.duration_ms >= job.abs_deadline) {
            job.miss_reported = true;
            g_stats[job.task_index].missed++;
            emit_event(cfg.duration_ms, "MISS", job.task_index,
                       "simulation ended after deadline");
        }
    }

    if (cfg.animate) {
        render_dashboard(cfg, cfg.duration_ms, -1, nullptr, ready, timeline, busy_ms);
        cout << "\033[?25h";
        cout << "\n\n";
    }

    cout << clr_bold()
         << "+==============================================================================+\n"
         << "| BMS SCHEDULER PERFORMANCE REPORT                                             |\n"
         << "+==============================================================================+\n"
         << clr_reset();
    cout << "Algorithm : " << algorithm_name(cfg.algorithm) << "\n";
    cout << "Duration  : " << cfg.duration_ms << " ms";
    cout << " | Mode: " << (cfg.stress ? "stress / overload" : "normal") << "\n\n";

    cout << left << setw(23) << "Task"
         << setw(10) << "Release"
         << setw(10) << "Done"
         << setw(10) << "Miss"
         << setw(11) << "Preempt"
         << setw(13) << "Avg turn"
         << "Avg wait\n";
    cout << string(86, '-') << "\n";

    int total_released = 0;
    int total_completed = 0;
    int total_missed = 0;
    int total_preemptions = 0;
    for (int i = 0; i < TASK_COUNT; ++i) {
        const TaskStats &s = g_stats[i];
        double avg_turn = s.completed ? static_cast<double>(s.turnaround_sum) / s.completed : 0.0;
        double avg_wait = s.completed ? static_cast<double>(s.waiting_sum) / s.completed : 0.0;
        total_released += s.released;
        total_completed += s.completed;
        total_missed += s.missed;
        total_preemptions += s.preemptions;

        cout << task_color(i)
             << left << setw(23) << g_tasks[i].name
             << setw(10) << s.released
             << setw(10) << s.completed
             << setw(10) << s.missed
             << setw(11) << s.preemptions
             << setw(13) << fixed_1(avg_turn)
             << fixed_1(avg_wait)
             << clr_reset() << "\n";
    }

    double miss_rate = total_released ? 100.0 * total_missed / total_released : 0.0;
    double measured_util = 100.0 * busy_ms / max(1, cfg.duration_ms);
    double demand_util = 0.0;
    for (const TaskSpec &task : g_tasks) demand_util += 100.0 * task.exec_ms / task.period_ms;

    cout << string(86, '-') << "\n";
    cout << "Total released        : " << total_released << "\n";
    cout << "Total completed       : " << total_completed << "\n";
    cout << "Total deadline misses : " << total_missed << " (" << fixed_1(miss_rate) << "%)\n";
    cout << "Total preemptions     : " << total_preemptions << "\n";
    cout << "CPU demand/utilization: " << fixed_1(demand_util) << "% demand, "
         << fixed_1(measured_util) << "% measured busy time\n";
    cout << "Final battery state   : SoC " << fixed_1(g_battery.soc) << "%, "
         << "Temp " << fixed_1(g_battery.temperature_c) << " C, "
         << "Pack " << fixed_1(g_battery.pack_voltage) << " V, "
         << "Cell spread " << fixed_2(g_battery.cell_spread_v) << " V\n";

    if (total_missed == 0) {
        cout << clr_green() << "\nAll deadlines met. Safety-critical BMS tasks stayed on schedule.\n" << clr_reset();
    } else {
        cout << clr_red() << "\nWarning: deadlines missed. Stress mode demonstrates overload behavior.\n" << clr_reset();
    }
    cout << "\nLog written to bms_log.txt\n";

    return nullptr;
}

static void print_help(const char *program) {
    cout << "Usage: " << program << " [options]\n\n";
    cout << "Scheduling options:\n";
    cout << "  --rms            Rate Monotonic Scheduling (default)\n";
    cout << "  --edf            Earliest Deadline First\n";
    cout << "  --priority       Fixed priority scheduling\n\n";
    cout << "Output options:\n";
    cout << "  --animate        Live Ubuntu terminal dashboard\n";
    cout << "  --no-animate     Plain execution log\n";
    cout << "  --fast           No animation delay\n";
    cout << "  --slow           Slower demo-friendly animation\n";
    cout << "  --delay N        Animation delay per frame in ms\n";
    cout << "  --no-color       Disable ANSI colors\n\n";
    cout << "Simulation options:\n";
    cout << "  --duration N     Simulation duration in ms (default 2000)\n";
    cout << "  --stress         Overload the BMS to demonstrate misses/preemption\n";
    cout << "  --help           Show this help\n";
}

static bool parse_int_arg(const char *value, int &target) {
    char *end = nullptr;
    long parsed = strtol(value, &end, 10);
    if (!end || *end != '\0' || parsed <= 0 || parsed > 60000) return false;
    target = static_cast<int>(parsed);
    return true;
}

static Config parse_args(int argc, char *argv[]) {
    Config cfg;
    cfg.animate = isatty(STDOUT_FILENO);
    cfg.color = isatty(STDOUT_FILENO);

    for (int i = 1; i < argc; ++i) {
        string arg = argv[i];
        if (arg == "rms" || arg == "--rms") {
            cfg.algorithm = Algorithm::RMS;
        } else if (arg == "edf" || arg == "--edf") {
            cfg.algorithm = Algorithm::EDF;
        } else if (arg == "priority" || arg == "--priority") {
            cfg.algorithm = Algorithm::PRIORITY;
        } else if (arg == "--animate") {
            cfg.animate = true;
        } else if (arg == "--no-animate") {
            cfg.animate = false;
        } else if (arg == "--fast") {
            cfg.frame_delay_ms = 0;
        } else if (arg == "--slow") {
            cfg.frame_delay_ms = 150;
        } else if (arg == "--delay") {
            if (i + 1 >= argc || !parse_int_arg(argv[i + 1], cfg.frame_delay_ms)) {
                cerr << "Invalid --delay value.\n";
                exit(2);
            }
            ++i;
        } else if (arg == "--no-color") {
            cfg.color = false;
        } else if (arg == "--stress") {
            cfg.stress = true;
        } else if (arg == "--duration") {
            if (i + 1 >= argc || !parse_int_arg(argv[i + 1], cfg.duration_ms)) {
                cerr << "Invalid --duration value.\n";
                exit(2);
            }
            ++i;
        } else if (arg == "--help" || arg == "-h") {
            print_help(argv[0]);
            exit(0);
        } else {
            cerr << "Unknown option: " << arg << "\n";
            cerr << "Run with --help for usage.\n";
            exit(2);
        }
    }

    if (!isatty(STDOUT_FILENO) && cfg.animate) {
        cfg.animate = false;
    }
    return cfg;
}

int main(int argc, char *argv[]) {
    Config cfg = parse_args(argc, argv);
    g_use_color = cfg.color;
    g_animate = cfg.animate;
    g_quiet = cfg.quiet;
    g_tasks = make_tasks(cfg.stress);
    g_stats.assign(TASK_COUNT, TaskStats{});
    g_battery = BatteryState{};

    if (pipe(g_log_pipe) != 0) {
        perror("pipe");
        return 1;
    }

    pthread_t log_thread;
    if (pthread_create(&log_thread, nullptr, logger_thread, nullptr) != 0) {
        perror("pthread_create logger");
        return 1;
    }

    pthread_t worker_threads[TASK_COUNT];
    for (int i = 0; i < TASK_COUNT; ++i) {
        g_worker_args[i].task_index = i;
        if (pthread_create(&worker_threads[i], nullptr, task_worker_thread, &g_worker_args[i]) != 0) {
            perror("pthread_create worker");
            return 1;
        }
    }

    SchedulerArgs scheduler_args{cfg};
    pthread_t scheduler;
    if (pthread_create(&scheduler, nullptr, scheduler_thread, &scheduler_args) != 0) {
        perror("pthread_create scheduler");
        stop_workers(worker_threads);
        return 1;
    }

    pthread_join(scheduler, nullptr);
    stop_workers(worker_threads);

    close(g_log_pipe[1]);
    pthread_join(log_thread, nullptr);
    close(g_log_pipe[0]);

    return 0;
}
