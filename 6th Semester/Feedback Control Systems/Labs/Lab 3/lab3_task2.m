syms s

k  = 200;
I1 = 0.2;
I2 = 0.1;

G2 = k/(I1*I2*s^2*(s^2 + k/I1 + k/I2));
G1 = (I2*s^2 + k)/(I1*I2*s^2*(s^2 + k/I1 + k/I2));

G2_simplified = simplify(G2)
G1_simplified = simplify(G1)

G2_pf = partfrac(G2_simplified, s)
G1_pf = partfrac(G1_simplified, s)
