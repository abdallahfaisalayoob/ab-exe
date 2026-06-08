s = tf('s');
G = 1/((s/0.5)+1)*(s+1)*((s/2)+1);
figure;
margin(G)
title('bode plot')
G_sys = feedback(G,1);
figure
step(G_sys)
title('step response')
stepinfo(G_sys)
tr = 0.3;
wbw_required = 2.2/tr;
wc = 25;
FRESP = evalfr(G,1j*wc);
Mc = abs(FRESP);
K = 1/Mc;
KG = K*G;
[GM,PM] = margin(KG)