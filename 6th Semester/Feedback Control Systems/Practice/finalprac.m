clc; clear; close all;
% =====================================================================
%  EE-3004 CEP Phase 2 : Lead Compensator Design (Bode method)
%  Ball & Balancer System
%  Procedure:
%    (a) set wc from the settling-time requirement, K = 1
%    (b) gain-only check  -> shows a compensator is needed
%    (c) design the lead to meet the phase-margin requirement at wc
%    (d) set the gain K LAST to place the crossover, then verify
% =====================================================================

%% Plant parameters (Phase-1 corrected: g is negative)
m = 0.11; R = 0.015; d = 0.03; g = -9.8; L_beam = 1.0; I = 9.99e-6;
Kp = -(m*g*d/L_beam)/(I/R^2 + m);          % plant gain = +0.20946
s  = tf('s');
G  = Kp/s^2;
fprintf('Plant gain Kp = %.5f\n', Kp);
disp('Open-loop plant G(s):'); G

%% ---------------- Part (a): frequency-domain specifications ----------------
%  %OS < 5%      -> zeta >= 0.69 (use 0.707)  -> PM ~ 100*zeta
%  Ts < 3 s (2%) -> Ts = 4/wc  -> wc = 4/Ts   (Kfactor = 4 for the 2% band)
zeta   = 0.707;
Ts_req = 3;
wc     = 4/Ts_req;                          % target crossover = 1.333 rad/s
wn_min = 4/(zeta*Ts_req);                   % min natural frequency
PM_req = 70;                                % required phase margin (deg)
fprintf('\n=== Part (a): Frequency-Domain Specifications ===\n');
fprintf('Damping ratio  zeta >= 0.69  (use %.3f)\n', zeta);
fprintf('Settling rule  Ts = 4/wc  ->  wc = 4/Ts  (2%% criterion)\n');
fprintf('Target crossover  wc = 4/%g = %.4f rad/s\n', Ts_req, wc);
fprintf('Min natural freq  wn >= %.4f rad/s\n', wn_min);
fprintf('Required phase margin  PM >= %d deg\n', PM_req);
fprintf('Steady-state error  ess = 0  (Type-2 plant)\n');

%% ---------------- Part (b): gain-only check (Dc = 1) ----------------
magG_wc    = Kp/wc^2;                        % |G(j*wc)|
K_gainOnly = 1/magG_wc;                      % gain to place crossover at wc with Dc=1
fprintf('\n=== Part (b): Gain-only check, Dc(s) = 1 ===\n');
fprintf('|G(j*wc)| = %.5f\n', magG_wc);
fprintf('Gain to put crossover at wc with Dc=1:  K = %.4f\n', K_gainOnly);
fprintf('Phase of K*G = -180 deg at all w  ->  PM = 0 deg.\n');
fprintf('A dynamic lead compensator is required; final K is set in Part (d).\n');
figure; margin(K_gainOnly*G);
title(sprintf('Part (b): Bode of K*G(s), K = %.2f  (PM = 0 deg)', K_gainOnly)); grid on;

%% ---------------- Part (c): lead compensator for PM at wc (K = 1) ----------------
%  Lead Dc(s) = (s+zc)/(s+pc). Zero near the origin -> the closed-loop pole it
%  creates is near-cancelled -> clean dominant 2nd-order response.
zc = 0.005;
pc = wc/tand( atand(wc/zc) - PM_req );       % pole supplies PM_req of lead at wc
Dc = (s+zc)/(s+pc);
phi_c = atand(wc/zc) - atand(wc/pc);         % phase the lead adds at wc (check)
fprintf('\n=== Part (c): Lead Compensator (K = 1) ===\n');
fprintf('Zero  zc = %.4f  (near origin -> near pole-zero cancellation)\n', zc);
fprintf('Pole  pc = %.4f\n', pc);
fprintf('Phase added by Dc at wc = %.2f deg\n', phi_c);
disp('Lead compensator Dc(s):'); Dc

%% ---------------- Part (d): set gain K LAST, then verify ----------------
attn = abs((1j*wc+zc)/(1j*wc+pc));           % |Dc(j*wc)|  (lead attenuates here)
K    = 1/(magG_wc*attn);                     % gain to restore the crossover at wc
Dcl  = K*Dc;                                 % full controller
Lol  = Dcl*G;                                % compensated open loop
fprintf('\n=== Part (d): Final gain K (set last) + verification ===\n');
fprintf('Lead attenuation at wc: |Dc(j*wc)| = %.4f  (%.2f dB)\n', attn, 20*log10(attn));
fprintf('Gain raised to  K = %.4f  to put the crossover back at wc.\n', K);
disp('Full controller  Dcl(s) = K*Dc(s):'); Dcl

[Gm, Pm, ~, Wcp] = margin(Lol);
fprintf('Crossover freq  wc = %.4f rad/s\n', Wcp);
fprintf('Phase Margin    PM = %.2f deg\n', Pm);
fprintf('Gain Margin     GM = %.2f dB   (-Inf is normal for a Type-2 plant)\n', 20*log10(Gm));
figure; margin(Lol);
title('Part (c)-(d): Bode of Compensated Open Loop  L(s) = Dcl(s)*G(s)'); grid on;
figure; rlocus(Lol);
title('Root Locus: Compensated System'); sgrid; grid on;

% ---- closed-loop step response (0.25 m reference) ----
T   = feedback(Lol,1);
ref = 0.25;
info = stepinfo(ref*T,'SettlingTimeThreshold',0.02);
ess  = abs(ref - dcgain(T)*ref)/ref*100;
fprintf('\n--- MATLAB stepinfo (0.25 m step) ---\n');
fprintf('Overshoot          = %.2f %%   (spec < 5%%)\n', info.Overshoot);
fprintf('Settling Time      = %.3f s   (spec < 3 s)\n', info.SettlingTime);
fprintf('Rise Time          = %.3f s\n', info.RiseTime);
fprintf('Steady-State Error = %.4f %%   (spec < 2%%)\n', ess);
fprintf('Closed-loop poles:\n'); disp(pole(T));
fprintf('Closed-loop bandwidth = %.4f rad/s\n', bandwidth(T));

% dominant 2nd-order prediction (after near pole-zero cancellation)
cl = pole(T); cp = cl(abs(imag(cl))>1e-3);
if ~isempty(cp)
    wn_d = abs(cp(1)); z_d = -real(cp(1))/wn_d;
    fprintf('Dominant pair: wn = %.4f rad/s, zeta = %.4f\n', wn_d, z_d);
    fprintf('Formula prediction: OS = %.2f %% | Ts = %.2f s\n', ...
            exp(-pi*z_d/sqrt(1-z_d^2))*100, 4/(z_d*wn_d));
end

figure; step(ref*T); hold on;
yline(ref*1.05,'r--','+5% limit'); yline(ref*0.95,'r--','-5% limit');
yline(ref,'k--','Reference = 0.25 m');
title('Closed-Loop Step Response (Reference = 0.25 m)');
xlabel('Time (s)'); ylabel('Ball Position y(t) [m]'); grid on;
figure; pzmap(T); title('Pole-Zero Map: Closed-Loop System'); grid on;
figure; nyquist(Lol); title('Nyquist Plot: Compensated Open Loop'); grid on;

%% ---------------- Iteration: effect of compensator pole (zc, wc fixed) ----------------
fprintf('\n=== Iteration: effect of compensator pole (zc, wc fixed) ===\n');
fprintf('  pole pc |  PM(deg) |  OS(%%) |  Ts(s)\n');
for pp = [2.5, pc, 5.0]
    Li = (1/(magG_wc*abs((1j*wc+zc)/(1j*wc+pp)))) * (s+zc)/(s+pp) * G;
    [~,Pmi] = margin(Li);
    si = stepinfo(ref*feedback(Li,1),'SettlingTimeThreshold',0.02);
    fprintf('  %6.3f  |  %6.2f  | %6.2f | %6.3f\n', pp, Pmi, si.Overshoot, si.SettlingTime);
end