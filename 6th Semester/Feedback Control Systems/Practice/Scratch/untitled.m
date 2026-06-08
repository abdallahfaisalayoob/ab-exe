s = tf('s');
G = 100/(s*(0.04*s + 1));

figure;
margin(G)
grid on;
title('Bode Plot')

G_sys = feedback(G,1);

figure;
step(G_sys)
grid on;
title('Step Response')

stepinfo(G_sys)

tr = 0.3;

wbw_required = 2.2/tr

wc = 25;

FRESP = evalfr(G,1j*wc);

Mc = abs(FRESP);

K = 1/Mc;

KG = K*G;

[GM,PM,Wcg,Wcp] = margin(KG)

sys_cl = feedback(KG,1);

figure;
step(sys_cl)
grid on;
title('Compensated Step Response')

stepinfo(sys_cl)

figure;
rlocus(KG)
grid on;
title('Root Locus')