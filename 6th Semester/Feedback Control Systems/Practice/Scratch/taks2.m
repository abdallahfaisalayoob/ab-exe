s = tf('s');
Kp = 9;
K = Kp;
G = K / (((s/0.5)+1)*(s+1)*((s/2)+1));

figure;
margin(G)
grid on;
title('Bode Plot')

[GM,PM,Wcg,Wcp] = margin(G)

wc = Wcp;

phi_required = 40 - PM;

alpha = (1 - sind(phi_required)) / (1 + sind(phi_required));

T = 1/(wc*sqrt(alpha));

Gc = (T*s + 1)/(alpha*T*s + 1);

sys_open = Gc*G;

figure;
margin(sys_open)
grid on;
title('Comp Bode Plot')

[GM_new,PM_new] = margin(sys_open)

G_sys = feedback(sys_open,1);

figure;
step(G_sys)
grid on;
title('CompStep Response')

sisotool(G_sys)
