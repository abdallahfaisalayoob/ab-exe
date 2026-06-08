zeta = 0.5;

wn1 = 2;
wn2 = 5;

Sys1 = tf([wn1^2],[1 2*zeta*wn1 wn1^2]);
Sys2 = tf([wn2^2],[1 2*zeta*wn2 wn2^2]);

info1 = stepinfo(Sys1);
info2 = stepinfo(Sys2);

disp('System 1 Step Info')
disp(info1)

disp('System 2 Step Info')
disp(info2)