import { createClient } from '@supabase/supabase-js';
import './styles.css';

/* ==========================================================================
   LT360 — Portal do Aluno (v1 integrada)
   Visual LT360 aprovado + dados REAIS do Supabase onde existem.
   O que é mock (marcado): disponibilidade/solicitações (Fase 3), cobranças
   (Fase 4), e os blocos "Meu progresso" e, quando não há aulas concluídas,
   "Últimas atividades". Tudo o mais vem do banco sob RLS de aluno.
   Campos ainda inexistentes no schema de aulas (título, tipo e local do
   treino) usam valores padrão — adicioná-los como colunas no futuro restaura
   a riqueza total dos cartões.
   ========================================================================== */
(function(){
  "use strict";

  var DIAS = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
  var MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

  function capitalizar(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
  function doisDig(n){ return (n<10?"0":"")+n; }
  function dataLocalStr(d){ return d.getFullYear()+"-"+doisDig(d.getMonth()+1)+"-"+doisDig(d.getDate()); }
  function fmtDataBR(iso){ var p=iso.split("-"); return p[2]+"/"+p[1]+"/"+p[0]; }
  function diaSemanaLabel(iso){ return DIAS[new Date(iso+"T00:00:00").getDay()]; }
  function dataLongaBR(d){ return capitalizar(DIAS[d.getDay()])+", "+d.getDate()+" de "+MESES[d.getMonth()]+" de "+d.getFullYear(); }
  function iniciais(nome){ var p=(nome||"").trim().split(/\s+/); if(!p[0])return"A"; return (p[0][0]+(p[1]?p[1][0]:"")).toUpperCase(); }
  function toast(msg){
    var t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
    clearTimeout(t.__t); t.__t=setTimeout(function(){ t.classList.remove("show"); },2200);
  }
  window.toast = toast;

  var HOJE = new Date();
  var HOJE_STR = dataLocalStr(HOJE);

  /* ---------------- Supabase (auth com lock desativado) ------------------- */
  var SB_URL = import.meta.env.VITE_SUPABASE_URL;
  var SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
  var sb = createClient(SB_URL, SB_KEY, {
    auth: { lock: function(name, acquireTimeout, fn){ return fn(); } }
  });

  /* ---------------- Estado (dados reais) ---------------------------------- */
  var meuAlunoId=null, meuProfessorId=null, meuNome="", meuEmail="", meuTelefone="";
  var meuTreinoTipo="forca", meuTreinoLocal="";
  var nomePersonal="Seu personal", logoPersonal=null, pixPersonal="";
  var aulas = [];              // reais: {id,data,hora,status}
  var minhasSolicitacoes = []; // reais: {id,aulaId,tipo,dataSugerida,horaSugerida,status,createdAt}
  var tabAtual = "inicio";
  var aulasTab = "proximas";   // sub-aba da tela Aulas
  var agendaSel = HOJE_STR;    // dia selecionado na Agenda

  /* ---------------- MOCK (marcado; vira back-end nas próximas fases) ------ */
  // Solicitações agora são REAIS (tabela solicitacoes). O que resta mock aqui
  // é o Financeiro (Fase 4) e o bloco de progresso.
  var MOCK = {
    cobrancas:[
      { mes:"Outubro de 2026",  valor:"R$ 280,00", detalhe:"Pago em 02/10/2026", metodo:"Pix", status:"Pago" },
      { mes:"Setembro de 2026", valor:"R$ 280,00", detalhe:"Pago em 02/09/2026", metodo:"Pix", status:"Pago" },
      { mes:"Agosto de 2026",   valor:"R$ 280,00", detalhe:"Pago em 02/08/2026", metodo:"Pix", status:"Pago" }
    ],
    progresso:{ peso:"—", pesoDelta:"", aulasRealizadas:null }   // sem fonte de dados ainda
  };
  var seqSolic = 1;

  /* =========================================================================
     AUTENTICAÇÃO (idêntica à versão validada — não alterar à toa)
     ========================================================================= */
  var authEventJaProcessado=false, sessaoConvite=null;
  function precisaDefinirSenha(session){ var m=session&&session.user&&session.user.user_metadata; return !!(m&&m.must_set_password); }
  function decidirDestino(session){
    if (precisaDefinirSenha(session)){
      sessaoConvite=session;
      document.getElementById("gate-loading").hidden=true;
      document.getElementById("gate-auth").hidden=false;
      mostrarAuthView("convite");
    } else { aposLogin(session); }
  }
  var urlTemAuthPendente = /access_token=|refresh_token=|[?&]code=|type=/.test(window.location.href);
  function resolverEstadoInicial(session){
    if (authEventJaProcessado) return;
    authEventJaProcessado=true;
    if (session){ decidirDestino(session); } else { mostrarGateAuth(); }
  }
  sb.auth.onAuthStateChange(function(event, session){
    if (event==="SIGNED_OUT"){ mostrarGateAuth(); mostrarAuthView("login"); return; }
    if (!authEventJaProcessado && !session && urlTemAuthPendente && event==="INITIAL_SESSION") return;
    resolverEstadoInicial(session);
  });
  if (!urlTemAuthPendente){
    sb.auth.getSession().then(function(s){ resolverEstadoInicial(s.data.session); }).catch(function(e){ console.error(e); });
  }
  function mostrarGateAuth(){ document.getElementById("gate-loading").hidden=true; document.getElementById("gate-auth").hidden=false; }
  function mostrarAuthView(nome){
    document.getElementById("authview-login").hidden = nome!=="login";
    document.getElementById("authview-convite").hidden = nome!=="convite";
  }
  function setErro(id,msg){ var e=document.getElementById(id); if(!e)return; e.textContent=msg||""; e.hidden=!msg; }
  window.toggleSenha = function(id){ var i=document.getElementById(id); if(i) i.type=i.type==="password"?"text":"password"; };

  window.entrar = async function(ev){
    ev.preventDefault();
    var email=document.getElementById("login-email").value.trim();
    var senha=document.getElementById("login-senha").value;
    var btn=document.getElementById("login-submit");
    setErro("login-erro","");
    if(!email||!senha){ setErro("login-erro","Informe e-mail e senha."); return; }
    btn.disabled=true; btn.textContent="Entrando...";
    try{ var r=await sb.auth.signInWithPassword({email:email,password:senha}); if(r.error) throw r.error; await aposLogin(r.data.session); }
    catch(err){ setErro("login-erro", traduzErroAuth(err)); btn.disabled=false; btn.textContent="Entrar"; }
  };
  window.definirSenhaConvite = async function(ev){
    ev.preventDefault();
    var senha=document.getElementById("convite-senha").value;
    var conf=document.getElementById("convite-senha-confirma").value;
    var btn=document.getElementById("convite-submit");
    setErro("convite-erro","");
    if(senha.length<6){ setErro("convite-erro","A senha precisa ter pelo menos 6 caracteres."); return; }
    if(senha!==conf){ setErro("convite-erro","As senhas não coincidem."); return; }
    btn.disabled=true; btn.textContent="Salvando...";
    try{
      var r=await sb.auth.updateUser({password:senha,data:{must_set_password:false}}); if(r.error) throw r.error;
      var s=await sb.auth.getSession();
      if(!s.data.session) throw new Error("Sessão expirou. Peça um novo convite ao seu personal.");
      await aposLogin(s.data.session,true);
    } catch(err){
      console.error("Erro ao definir senha do convite:",err);
      setErro("convite-erro",(err&&err.message)||"Não foi possível salvar a senha. Peça um novo convite.");
      btn.disabled=false; btn.textContent="Criar senha e entrar";
    }
  };
  function traduzErroAuth(err){
    var m=(err&&err.message)||"Erro ao autenticar.";
    if(/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
    if(/Email not confirmed/i.test(m)) return "Confirme seu e-mail antes de entrar.";
    return m;
  }
  async function aposLogin(session, viaConvite){
    if(!viaConvite && precisaDefinirSenha(session)) return;
    try{ await carregarMeusDados(session.user.id); }
    catch(err){
      console.error(err);
      mostrarGateAuth();
      setErro("login-erro","Não consegui carregar seus dados. Tente novamente em alguns minutos.");
      var b=document.getElementById("login-submit"); if(b){ b.disabled=false; b.textContent="Entrar"; }
      var bc=document.getElementById("convite-submit"); if(bc){ bc.disabled=false; bc.textContent="Criar senha e entrar"; }
      return;
    }
    document.getElementById("gate").hidden=true;
    document.getElementById("app").hidden=false;
    document.getElementById("topbar-date").textContent = dataLongaBR(HOJE);
    document.getElementById("btn-bell").innerHTML = IC.bell;
    document.getElementById("topbar-avatar").textContent = iniciais(meuNome);
    renderShell();
    ir("inicio");
  }

  async function carregarMeusDados(authUserId){
    var alunoRes = await sb.from("alunos").select("id, nome, telefone, professor_id, treino_tipo, treino_local").eq("auth_user_id", authUserId).maybeSingle();
    if (alunoRes.error) throw alunoRes.error;
    if (!alunoRes.data) throw new Error("Cadastro de aluno não encontrado.");
    meuAlunoId=alunoRes.data.id; meuProfessorId=alunoRes.data.professor_id;
    meuNome=alunoRes.data.nome||""; meuTelefone=alunoRes.data.telefone||"";
    meuTreinoTipo=alunoRes.data.treino_tipo||"forca"; meuTreinoLocal=alunoRes.data.treino_local||"";

    var sess=await sb.auth.getSession();
    meuEmail=(sess.data.session&&sess.data.session.user&&sess.data.session.user.email)||"";

    var res=await Promise.all([
      sb.from("aulas").select("id, data, hora, status").eq("aluno_id", meuAlunoId),
      sb.from("profiles").select("nome, logo_url, pix").eq("id", meuProfessorId).maybeSingle()
    ]);
    if(res[0].error) throw res[0].error;
    if(res[1].error) throw res[1].error;
    aulas=(res[0].data||[]).map(function(r){ return {id:r.id,data:r.data,hora:(r.hora||"").slice(0,5),status:r.status}; });
    var prof=res[1].data||{};
    nomePersonal=prof.nome||"Seu personal"; logoPersonal=prof.logo_url||null;
    pixPersonal=prof.pix||"(chave PIX não cadastrada)";

    // Solicitações reais (tolerante: se a tabela ainda não existir, não quebra o login).
    try {
      var sres = await sb.from("solicitacoes")
        .select("id, aula_id, tipo, data_sugerida, hora_sugerida, status, created_at, resposta")
        .eq("aluno_id", meuAlunoId);
      minhasSolicitacoes = sres.error ? [] : (sres.data||[]).map(rowToSolic);
    } catch(e){ minhasSolicitacoes = []; }
  }
  function rowToSolic(r){
    return { id:r.id, aulaId:r.aula_id, tipo:r.tipo,
      dataSugerida:r.data_sugerida, horaSugerida:(r.hora_sugerida||"").slice(0,5),
      status:r.status, createdAt:r.created_at, resposta:r.resposta||"" };
  }

  window.sairDaConta = function(){ sb.auth.signOut().then(function(){ location.reload(); }); };

  // rede de segurança
  setTimeout(function(){
    if(authEventJaProcessado) return;
    sb.auth.getSession().then(function(s){ resolverEstadoInicial(s.data.session); }).catch(function(err){
      console.error(err);
      if(!authEventJaProcessado){ authEventJaProcessado=true; mostrarGateAuth(); setErro("login-erro","Falha ao conectar no servidor. Tente recarregar a página."); }
    });
  }, 2000);

  /* =========================================================================
     Derivações a partir das aulas REAIS
     ========================================================================= */
  function aulaPassou(a){ return new Date(a.data+"T"+(a.hora||"00:00")+":00").getTime() <= Date.now(); }
  function ativa(a){ return a.status!=="cancelada" && a.status!=="remarcada"; }
  function ehProxima(a){ return (a.status==="agendada"||a.status==="confirmada") && !aulaPassou(a); }
  function ordAsc(x,y){ return (x.data+x.hora) < (y.data+y.hora) ? -1 : 1; }
  function ordDesc(x,y){ return (x.data+x.hora) > (y.data+y.hora) ? -1 : 1; }

  function proximasAulas(){ return aulas.filter(ehProxima).sort(ordAsc); }
  function labelStatusAula(st){
    if(st==="concluida") return "Concluída";
    if(st==="cancelada") return "Cancelada";
    if(st==="confirmada") return "Confirmada";
    return "Agendada";
  }
  // Enriquecimento visual do treino (por aluno): tipo/local vêm do cadastro.
  function labelTipo(t){
    if(t==="forca") return "Treino de Força";
    if(t==="funcional") return "Treino Funcional";
    if(t==="cardio") return "Treino de Cardio";
    return "Treino";
  }
  function enriquecer(a){
    return { id:a.id, data:a.data, hora:a.hora, status:a.status,
      titulo:labelTipo(meuTreinoTipo), sub:"Com "+nomePersonal, local:meuTreinoLocal, tipo:meuTreinoTipo,
      statusLabel:labelStatusAula(a.status) };
  }

  function segundaDaSemana(d){
    var x=new Date(d.getTime()); var dow=x.getDay(); var diff=(dow===0?-6:1-dow);
    x.setDate(x.getDate()+diff); x.setHours(0,0,0,0); return x;
  }
  function derivarInicio(){
    var mes = HOJE_STR.slice(0,7);
    var noMes = aulas.filter(function(a){ return a.data.slice(0,7)===mes && ativa(a); });
    var realizadasMes = noMes.filter(function(a){ return a.status==="concluida"; }).length;
    var prox = proximasAulas();

    // semana (segunda a domingo)
    var seg = segundaDaSemana(HOJE); var dias=[]; var letras=["S","T","Q","Q","S","S","D"];
    var semAulas=0, semReal=0;
    for(var i=0;i<7;i++){
      var d=new Date(seg.getTime()); d.setDate(seg.getDate()+i); var ds=dataLocalStr(d);
      var daquele=aulas.filter(function(a){ return a.data===ds && ativa(a); });
      if(daquele.length){ semAulas++; if(daquele.some(function(a){return a.status==="concluida";})) semReal++; }
      dias.push({ l:letras[i], n:doisDig(d.getDate()), sel:ds===HOJE_STR, dot:daquele.length>0 });
    }

    // últimas atividades: a partir das aulas concluídas (real); fallback mock
    var atividades = aulas.filter(function(a){return a.status==="concluida";}).sort(ordDesc).slice(0,3).map(function(a){
      return { ic:"running", cor:"teal", titulo:"Treino realizado", sub:capitalizar(diaSemanaLabel(a.data))+", "+a.hora, quando:fmtDataBR(a.data).slice(0,5) };
    });

    return {
      proxima: prox[0] ? enriquecer(prox[0]) : null,
      aulasMes:{ v:realizadasMes, t:noMes.length },
      proximas: prox.length,
      semana:{ qtd:semAulas, realizadas:semReal, total:(semAulas||1), dias:dias,
               periodo: doisDig(seg.getDate())+"/"+doisDig(seg.getMonth()+1)+" - "+(function(){var f=new Date(seg.getTime());f.setDate(seg.getDate()+6);return doisDig(f.getDate())+"/"+doisDig(f.getMonth()+1);})() },
      solicitacoes: minhasSolicitacoes.filter(function(s){return s.status==="em_analise";}).length,
      atividades: atividades,
      progresso: MOCK.progresso
    };
  }

  /* =========================================================================
     ÍCONES / NAV / tipos de treino
     ========================================================================= */
  var IC = {
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8v10h-6v-7h-6v7H3z"/></svg>',
    aulas:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    agenda:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg>',
    mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>',
    financeiro:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10h18M7 15h4"/></svg>',
    bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    chevR:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    chevL:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
    clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    dumbbell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11M4 9l5-5M2 7l5-5M15 20l5-5M17 22l5-5"/></svg>',
    running:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="5" r="2"/><path d="M14 8l-3 3 2 3 1 5M11 11l-4 1-2 4M13 14l4 1 2 3"/></svg>',
    heart:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7.5-4.6-10-9.3C.6 8.9 2 5.5 5.2 5.1 7 4.9 8.6 5.9 12 9c3.4-3.1 5-4.1 6.8-3.9C22 5.5 23.4 8.9 22 11.7 19.5 16.4 12 21 12 21z"/></svg>',
    trophy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v3a6 6 0 0 1-12 0V4z"/><path d="M6 6H3v1a3 3 0 0 0 3 3M18 6h3v1a3 3 0 0 1-3 3M9 15h6M8 20h8M10 15l-.5 5M14 15l.5 5"/></svg>',
    box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
    arrowDown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    pix:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l3.2 3.2a2 2 0 0 0 1.4.6H18L21.5 9.8a2 2 0 0 1 0 2.8L18 16.1h-1.4a2 2 0 0 0-1.4.6L12 20.9l-3.2-3.2a2 2 0 0 0-1.4-.6H6L2.5 13.6a2 2 0 0 1 0-2.8L6 7.3h1.4a2 2 0 0 0 1.4-.6L12 2.5z"/></svg>',
    logout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>'
  };
  var NAV = [
    {id:"inicio",label:"Início",ic:"home"},{id:"aulas",label:"Aulas",ic:"aulas"},
    {id:"agenda",label:"Agenda",ic:"agenda"},{id:"solicitacoes",label:"Solicitações",ic:"mail"},
    {id:"financeiro",label:"Financeiro",ic:"financeiro"}
  ];
  var TIPO = { forca:{ic:"dumbbell",tile:"tile-graf"}, funcional:{ic:"running",tile:"tile-azul"}, cardio:{ic:"heart",tile:"tile-vermelho"} };

  /* =========================================================================
     Shell (sidebar, bottom nav, header mobile)
     ========================================================================= */
  function renderShell(){
    document.getElementById("sidebar-nav").innerHTML = NAV.map(function(n){
      return '<button class="navitem'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="navitem-ic">'+IC[n.ic]+'</span>'+n.label+'</button>';
    }).join("");
    document.getElementById("sidebar-foot").innerHTML =
      '<button class="perfil-link" onclick="ir(\'perfil\')"><span class="avatar avatar-foto">'+iniciais(meuNome)+'</span>'+
        '<span class="perfil-link-txt"><b>'+meuNome+'</b><span>Ver perfil '+IC.chevR+'</span></span></button>'+
      '<div class="personal-box"><div class="personal-cap">Seu personal</div>'+
        '<div class="personal-row"><span class="avatar avatar-foto">'+iniciais(nomePersonal)+'</span>'+
        '<span class="personal-txt"><b>'+nomePersonal+'</b><span>Personal Trainer</span></span></div></div>';
    document.getElementById("bottomnav").innerHTML = NAV.map(function(n){
      return '<button class="bn-btn'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="bn-ic">'+IC[n.ic]+'</span><span class="bn-lb">'+n.label+'</span></button>';
    }).join("");
    renderMHeader();
  }
  function renderMHeader(){
    var el=document.getElementById("m-header");
    if(tabAtual==="inicio"){
      el.className="m-header m-header-inicio";
      el.innerHTML='<img class="logo-img logo-img-m" src="/logo_lt360.png" alt="LT360">'+
        '<div class="m-header-right"><button class="icon-btn has-dot">'+IC.bell+'</button>'+
        '<div class="avatar avatar-sm" onclick="ir(\'perfil\')">'+iniciais(meuNome)+'</div></div>';
    } else {
      el.className="m-header m-header-titulo";
      var lbl = tabAtual==="perfil" ? "Meu perfil" : (NAV.filter(function(n){return n.id===tabAtual;})[0]||{label:""}).label;
      el.innerHTML='<h1 class="m-title">'+lbl+'</h1>';
    }
  }

  /* ---------------- componentes ------------------------------------------- */
  function statusBadge(st){
    var cls="ok";
    if(st==="Em análise"||st==="Pendente") cls="warn";
    else if(st==="Negada"||st==="Cancelada") cls="dang";
    return '<span class="badge badge-'+cls+'">'+st+'</span>';
  }
  function tileTreino(tipo){ var t=TIPO[tipo]||TIPO.forca; return '<span class="treino-tile '+t.tile+'">'+IC[t.ic]+'</span>'; }
  function cardAula(a, comLocal){
    return '<div class="aula-item">'+tileTreino(a.tipo)+
      '<div class="aula-item-info"><div class="aula-item-hora">'+a.hora+'</div>'+
      '<div class="aula-item-tit">'+a.titulo+'</div><div class="aula-item-sub">'+a.sub+'</div>'+
      (comLocal&&a.local?'<div class="aula-item-local">'+IC.pin+a.local+'</div>':'')+'</div>'+
      '<div class="aula-item-dir">'+statusBadge(a.statusLabel)+'<span class="chev">'+IC.chevR+'</span></div></div>';
  }

  /* =========================================================================
     TELA: Início
     ========================================================================= */
  function screenInicio(){
    var D=derivarInicio();
    var proxima = D.proxima
      ? '<div class="card prox-card"><div class="prox-head"><span class="prox-cap">PRÓXIMA AULA</span>'+statusBadge(D.proxima.statusLabel)+'</div>'+
          '<div class="prox-main">'+tileTreino(D.proxima.tipo)+
            '<div class="prox-info"><div class="prox-dh"><span class="dh-long">'+capitalizar(diaSemanaLabel(D.proxima.data))+', '+fmtDataBR(D.proxima.data).slice(0,5)+' • '+D.proxima.hora+'</span>'+
              '<span class="dh-short">'+fmtDataBR(D.proxima.data).slice(0,5)+' • '+D.proxima.hora+'</span></div>'+
              '<div class="prox-tit">'+D.proxima.titulo+'</div><div class="prox-sub">'+D.proxima.sub+'</div>'+
              (D.proxima.local?'<div class="prox-local">'+IC.pin+D.proxima.local+'</div>':'')+'</div>'+
            '<span class="chev chev-lg">'+IC.chevR+'</span></div>'+
          '<div class="prox-acoes"><button class="btn btn-primary" onclick="ir(\'agenda\')">Ver detalhes</button>'+
            '<button class="btn btn-dark" onclick="solicitarRemarcacao(\''+D.proxima.id+'\')">Remarcar</button>'+
            '<button class="btn btn-dang" onclick="solicitarCancelamento(\''+D.proxima.id+'\')">Cancelar</button></div></div>'
      : '<div class="card prox-card"><div class="prox-head"><span class="prox-cap">PRÓXIMA AULA</span></div>'+
          '<div class="lista-vazia" style="padding:14px 2px">Você não tem aulas agendadas no momento.</div></div>';

    var s=D.semana; var pct = s.total? Math.round(s.realizadas/s.total*100):0;
    var semana='<div class="card semana-card"><div class="semana-top">'+
      '<div><div class="semana-cap">Sua semana</div><div class="semana-n">'+s.qtd+' aulas</div><div class="semana-per">'+s.periodo+'</div></div>'+
      '<div class="ring" style="--pct:'+pct+'"><div class="ring-in"><b>'+s.realizadas+'/'+s.total+'</b><span>aulas realizadas</span></div></div></div>'+
      '<div class="semana-dias">'+s.dias.map(function(d){ return '<div class="sd"><span class="sd-l">'+d.l+'</span><span class="sd-n'+(d.sel?' sel':'')+'">'+d.n+'</span><span class="sd-dot'+(d.dot?' on':'')+'"></span></div>'; }).join("")+'</div></div>';

    function statCard(cls,ic,cap,val,extra){ return '<div class="card stat-card"><span class="stat-ic '+cls+'">'+IC[ic]+'</span><div class="stat-txt"><span class="stat-cap">'+cap+'</span><span class="stat-val">'+val+'</span>'+(extra||"")+'</div></div>'; }
    var barra = D.aulasMes.t ? Math.round(D.aulasMes.v/D.aulasMes.t*100) : 0;
    var stats='<div class="stat-row">'+
      statCard("si-teal","agenda","Aulas do mês",D.aulasMes.v+'<span class="stat-sm">/'+D.aulasMes.t+'</span>','<div class="stat-bar"><span style="width:'+barra+'%"></span></div>')+
      statCard("si-azul","running","Próximas aulas",String(D.proximas),'<span class="stat-foot">agendadas</span>')+
      statCard("si-verde","box",'<span>Financeiro</span>','<span class="verde">Em dia</span> <span class="mini-check">'+IC.check+'</span>',"")+
      statCard("si-amber","trophy","Solicitações",String(D.solicitacoes),'<span class="stat-foot">em análise <span class="mini-clock">'+IC.clock+'</span></span>')+
      '</div>';

    var atividades='<div class="card lista-card"><div class="card-head"><h3>Últimas atividades</h3><button class="link" onclick="toast(\'Em breve\')">Ver todas</button></div>'+
      (D.atividades.length ? D.atividades.map(function(a){ return '<div class="ativ-row"><span class="ativ-ic '+a.cor+'">'+IC[a.ic]+'</span><div class="ativ-info"><div class="ativ-tit">'+a.titulo+'</div><div class="ativ-sub">'+a.sub+'</div></div><div class="ativ-dir"><span>'+a.quando+'</span>'+IC.chevR+'</div></div>'; }).join("")
        : '<div class="lista-vazia" style="padding:12px 2px">Sem atividades recentes.</div>')+'</div>';

    var pr=D.progresso;
    var progresso='<div class="card lista-card"><div class="card-head"><h3>Meu progresso</h3><button class="link" onclick="toast(\'Em breve\')">Ver evolução</button></div>'+
      '<div class="prog-grid"><div class="prog-col"><div class="prog-cap">Peso atual '+IC.chevR+'</div><div class="prog-val">'+pr.peso+(pr.peso!=="—"?' <span>kg</span>':'')+'</div>'+
        '<div class="prog-foot">registre no app (em breve)</div></div>'+
      '<div class="prog-col"><div class="prog-cap">Aulas realizadas '+IC.chevR+'</div><div class="prog-val">'+(aulas.filter(function(a){return a.status==="concluida";}).length)+'</div><div class="prog-foot">no total</div></div></div></div>';

    return '<div class="hero"><div class="hero-txt"><h1>Olá, '+(meuNome.split(" ")[0]||"aluno")+'!</h1><p>Vamos em busca de mais resultados! 💪</p></div></div>'+
      '<div class="grid-prox">'+proxima+semana+'</div>'+stats+'<div class="grid-2">'+atividades+progresso+'</div>';
  }

  /* =========================================================================
     TELA: Aulas (próximas / realizadas / canceladas) — real
     ========================================================================= */
  function listaAulasPorTab(){
    var arr;
    if(aulasTab==="realizadas") arr=aulas.filter(function(a){ return a.status==="concluida" || ((a.status==="agendada"||a.status==="confirmada")&&aulaPassou(a)); }).sort(ordDesc);
    else if(aulasTab==="canceladas") arr=aulas.filter(function(a){ return a.status==="cancelada"; }).sort(ordDesc);
    else arr=proximasAulas();
    return arr.map(enriquecer);
  }
  window.setAulasTab = function(t){ aulasTab=t; ir("aulas"); };
  function screenAulas(){
    var lista=listaAulasPorTab();
    var tabs='<div class="seg">'+
      '<button class="seg-b'+(aulasTab==="proximas"?" active":"")+'" onclick="setAulasTab(\'proximas\')">Próximas</button>'+
      '<button class="seg-b'+(aulasTab==="realizadas"?" active":"")+'" onclick="setAulasTab(\'realizadas\')">Realizadas</button>'+
      '<button class="seg-b'+(aulasTab==="canceladas"?" active":"")+'" onclick="setAulasTab(\'canceladas\')">Canceladas</button></div>';
    // agrupa por dia
    var porDia={}, ordem=[];
    lista.forEach(function(a){ if(!porDia[a.data]){ porDia[a.data]=[]; ordem.push(a.data); } porDia[a.data].push(a); });
    var corpo = ordem.length ? ordem.map(function(ds){
      return '<div class="aulas-grupo"><div class="grupo-dia">'+capitalizar(diaSemanaLabel(ds))+', '+fmtDataBR(ds)+'</div>'+porDia[ds].map(function(a){return cardAula(a,false);}).join("")+'</div>';
    }).join("") : '<div class="lista-vazia">Nenhuma aula nesta lista.</div>';
    return '<div class="only-desktop pg-head"><h1>Aulas</h1></div>'+tabs+corpo;
  }

  /* =========================================================================
     TELA: Agenda — calendário do mês atual + detalhe do dia (real)
     ========================================================================= */
  function diasComAula(mesPrefix){
    var set={}; aulas.forEach(function(a){ if(a.data.slice(0,7)===mesPrefix && ativa(a)) set[parseInt(a.data.slice(8),10)]=true; }); return set;
  }
  window.selecionarDiaAgenda = function(ds){ agendaSel=ds; ir("agenda"); };
  function screenAgenda(){
    var ano=HOJE.getFullYear(), mes=HOJE.getMonth();
    var mesPrefix = ano+"-"+doisDig(mes+1);
    var primeiro = new Date(ano,mes,1).getDay();
    var diasNoMes = new Date(ano,mes+1,0).getDate();
    var dots=diasComAula(mesPrefix);
    var cells=[]; for(var i=0;i<primeiro;i++) cells.push(null); for(var d=1;d<=diasNoMes;d++) cells.push(d);
    while(cells.length%7) cells.push(null);
    var wk=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
    var cal='<div class="cal-nav"><button class="cal-arrow" onclick="toast(\'Navegação de mês: em breve\')">'+IC.chevL+'</button>'+
      '<span class="cal-mes">'+capitalizar(MESES[mes])+' de '+ano+'</span>'+
      '<button class="cal-arrow" onclick="toast(\'Navegação de mês: em breve\')">'+IC.chevR+'</button></div>'+
      '<div class="cal-head">'+wk.map(function(w){return '<span>'+w+'</span>';}).join("")+'</div>'+
      '<div class="cal-grid">'+cells.map(function(d){
        if(d===null) return '<span class="cal-cell empty"></span>';
        var ds=mesPrefix+"-"+doisDig(d); var sel=ds===agendaSel; var dot=dots[d];
        return '<span class="cal-cell'+(sel?' sel':'')+'" onclick="selecionarDiaAgenda(\''+ds+'\')"><span class="cal-n">'+d+'</span>'+(dot?'<span class="cal-dot teal"></span>':'')+'</span>';
      }).join("")+'</div>';

    var doDia = aulas.filter(function(a){ return a.data===agendaSel && ativa(a); }).sort(ordAsc).map(enriquecer);
    var detalhe='<div class="card agenda-det"><div class="agenda-det-dia">'+capitalizar(diaSemanaLabel(agendaSel))+', '+fmtDataBR(agendaSel)+'</div>'+
      (doDia.length ? doDia.map(function(it){ return '<div class="agenda-det-item"><div class="agenda-det-hora"><span class="dot-teal"></span>'+it.hora+'</div>'+cardAula(it,true)+'</div>'; }).join("")
        : '<div class="lista-vazia" style="padding:12px 2px">Nenhuma aula neste dia.</div>')+'</div>';

    return '<div class="only-desktop pg-head"><h1>Agenda</h1><p class="pg-sub">Visualize todas as suas aulas e compromissos.</p></div>'+
      '<div class="agenda-wrap"><div class="agenda-cal card">'+cal+'</div><div class="agenda-lado">'+
      '<div class="seg seg-agenda only-desktop"><button class="seg-b active">Mês</button><button class="seg-b" onclick="toast(\'Semana: em breve\')">Semana</button><button class="seg-b" onclick="toast(\'Lista: em breve\')">Lista</button></div>'+
      detalhe+'</div></div>';
  }

  /* =========================================================================
     TELA: Solicitações (mock — Fase 3)
     ========================================================================= */
  function labelStatusSolic(st){ if(st==="aprovada")return"Aprovada"; if(st==="negada")return"Negada"; return"Em análise"; }
  function visualSolic(s){ return s.tipo==="remarcar" ? {titulo:"Remarcação de aula",ic:"agenda",cor:"red"} : {titulo:"Cancelamento de aula",ic:"check",cor:"green"}; }
  function quandoSolic(s){
    if(s.tipo==="remarcar" && s.dataSugerida){ return "Novo: "+capitalizar(diaSemanaLabel(s.dataSugerida)).slice(0,3)+", "+fmtDataBR(s.dataSugerida).slice(0,5)+(s.horaSugerida?" • "+s.horaSugerida:""); }
    var a=getAula(s.aulaId);
    if(a) return capitalizar(diaSemanaLabel(a.data)).slice(0,3)+", "+fmtDataBR(a.data).slice(0,5)+" • "+a.hora;
    return "";
  }
  function screenSolic(){
    var tabs='<div class="seg seg-wrap"><button class="seg-b active">Todas</button>'+
      '<button class="seg-b" onclick="toast(\'Filtro: em breve\')">Em análise</button>'+
      '<button class="seg-b" onclick="toast(\'Filtro: em breve\')">Aprovadas</button>'+
      '<button class="seg-b" onclick="toast(\'Filtro: em breve\')">Negadas</button></div>';
    var nova='<button class="btn btn-primary btn-nova" onclick="toast(\'Para pedir remarcação ou cancelamento, use os botões na aba Aulas.\')">'+IC.plus+' Nova solicitação</button>';
    var ordenadas = minhasSolicitacoes.slice().sort(function(x,y){ return (y.createdAt||"")<(x.createdAt||"")?-1:1; });
    var lista = ordenadas.length ? ordenadas.map(function(s){
      var v=visualSolic(s);
      return '<div class="solic-card"><span class="solic-ic '+v.cor+'">'+IC[v.ic]+'</span>'+
        '<div class="solic-info"><div class="solic-tit">'+v.titulo+'</div><div class="solic-quando">'+quandoSolic(s)+'</div>'+
        '<div class="solic-sol">Solicitado em '+fmtDataBR((s.createdAt||HOJE_STR).slice(0,10))+'</div></div>'+
        '<div class="solic-dir">'+statusBadge(labelStatusSolic(s.status))+'<span class="chev">'+IC.chevR+'</span></div></div>';
    }).join("") : '<div class="lista-vazia">Você ainda não fez nenhuma solicitação.</div>';
    return '<div class="only-desktop pg-head"><h1>Solicitações</h1></div>'+tabs+nova+lista;
  }

  function getAula(id){ for(var i=0;i<aulas.length;i++) if(aulas[i].id===id) return aulas[i]; return null; }
  function addDias(ds,n){ var d=new Date(ds+"T00:00:00"); d.setDate(d.getDate()+n); return dataLocalStr(d); }

  // ---- Modal de solicitação (remarcar / cancelar) ----
  window.fecharModalSolic = function(ev){ if(ev && ev.target && ev.target.id!=="modal-overlay" && ev.type==="click") return; document.getElementById("modal-overlay").hidden=true; };
  function abrirModal(html){ document.getElementById("modal-conteudo").innerHTML=html; document.getElementById("modal-overlay").hidden=false; }

  window.solicitarRemarcacao = function(id){
    var a=getAula(id); if(!a) return;
    abrirModal(
      '<div class="modal-tit">Pedir remarcação</div>'+
      '<div class="modal-sub">Aula atual: '+capitalizar(diaSemanaLabel(a.data))+', '+fmtDataBR(a.data)+' • '+a.hora+'</div>'+
      '<div class="field"><label for="solic-data">Nova data</label><input id="solic-data" type="date" value="'+addDias(a.data,1)+'"></div>'+
      '<div class="field"><label for="solic-hora">Novo horário</label><input id="solic-hora" type="time" value="'+a.hora+'"></div>'+
      '<div class="field"><label for="solic-msg">Mensagem (opcional)</label><textarea id="solic-msg" placeholder="Ex.: tenho um compromisso nesse horário"></textarea></div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="fecharModalSolic()">Voltar</button>'+
      '<button class="btn btn-primary" id="solic-enviar" onclick="enviarSolicitacao(\'remarcar\',\''+id+'\')">Enviar pedido</button></div>');
  };
  window.solicitarCancelamento = function(id){
    var a=getAula(id); if(!a) return;
    abrirModal(
      '<div class="modal-tit">Pedir cancelamento</div>'+
      '<div class="modal-sub">Aula: '+capitalizar(diaSemanaLabel(a.data))+', '+fmtDataBR(a.data)+' • '+a.hora+'</div>'+
      '<div class="field"><label for="solic-msg">Mensagem (opcional)</label><textarea id="solic-msg" placeholder="Conte o motivo, se quiser"></textarea></div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="fecharModalSolic()">Voltar</button>'+
      '<button class="btn btn-dang" id="solic-enviar" onclick="enviarSolicitacao(\'cancelar\',\''+id+'\')">Enviar pedido</button></div>');
  };

  window.enviarSolicitacao = async function(tipo, aulaId){
    var msgEl=document.getElementById("solic-msg");
    var payload={ aluno_id:meuAlunoId, professor_id:meuProfessorId, aula_id:aulaId, tipo:tipo, mensagem:(msgEl&&msgEl.value.trim())||null };
    if(tipo==="remarcar"){
      var d=document.getElementById("solic-data").value, h=document.getElementById("solic-hora").value;
      if(!d||!h){ toast("Informe a nova data e o horário."); return; }
      payload.data_sugerida=d; payload.hora_sugerida=h;
    }
    var btn=document.getElementById("solic-enviar"); if(btn){ btn.disabled=true; btn.textContent="Enviando..."; }
    var r=await sb.from("solicitacoes").insert(payload).select().maybeSingle();
    if(r.error){ console.error(r.error); toast("Não foi possível enviar: "+(r.error.message||"erro")); if(btn){btn.disabled=false;btn.textContent="Enviar pedido";} return; }
    if(r.data) minhasSolicitacoes.unshift(rowToSolic(r.data));
    document.getElementById("modal-overlay").hidden=true;
    toast("Solicitação enviada ao personal.");
    ir("solicitacoes");
  };

  /* =========================================================================
     TELA: Financeiro (mock cobranças; PIX real)
     ========================================================================= */
  function screenFinanceiro(){
    var tabs='<div class="seg"><button class="seg-b active">Cobranças</button><button class="seg-b" onclick="toast(\'Histórico: em breve\')">Histórico</button></div>';
    var banner='<div class="fin-banner"><span class="fin-banner-ic">'+IC.check+'</span><div><div class="fin-banner-t">Sua mensalidade está em dia!</div><div class="fin-banner-s">Próximo vencimento em 05/11/2026</div></div></div>';
    var cobr=MOCK.cobrancas.map(function(c){
      return '<div class="card cobr-card"><div class="cobr-main"><div class="cobr-mes">'+c.mes+'</div><div class="cobr-val">'+c.valor+'</div>'+
        '<div class="cobr-det"><span class="cobr-dot green"></span>'+c.detalhe+'</div>'+
        '<div class="cobr-pix"><span class="cobr-pix-ic">'+IC.pix+'</span>'+c.metodo+'</div></div>'+
        '<div class="cobr-dir">'+statusBadge(c.status)+'<span class="chev">'+IC.chevR+'</span></div></div>';
    }).join("");
    return '<div class="only-desktop pg-head"><h1>Financeiro</h1></div>'+tabs+banner+cobr;
  }

  /* =========================================================================
     TELA: Perfil (real; trocar senha real)
     ========================================================================= */
  function linhaPerfil(r,v){ return '<div class="perfil-linha"><span class="perfil-rot">'+r+'</span><span class="perfil-val">'+(v||"—")+'</span></div>'; }
  function screenPerfil(){
    var dados='<div class="perfil-foto-bloco"><div class="perfil-foto">'+iniciais(meuNome)+'</div><button class="btn btn-dark" disabled>Trocar foto (em breve)</button></div>'+
      '<div class="perfil-dados">'+linhaPerfil("Nome",meuNome)+linhaPerfil("E-mail",meuEmail)+linhaPerfil("Telefone",meuTelefone)+linhaPerfil("Personal",nomePersonal)+'</div>';
    var senha='<h3 class="section-title">Trocar senha</h3>'+
      '<form class="perfil-form" onsubmit="trocarSenha(event)"><div class="auth-erro" id="senha-erro" hidden></div><div class="auth-msg" id="senha-msg" hidden></div>'+
      '<div class="field"><label for="nova-senha">Nova senha</label><div class="input-ic"><input id="nova-senha" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres"><button type="button" class="input-ic-eye" onclick="toggleSenha(\'nova-senha\')">&#128065;</button></div></div>'+
      '<div class="field"><label for="nova-senha-confirma">Confirmar nova senha</label><input id="nova-senha-confirma" type="password" autocomplete="new-password" placeholder="Repita a nova senha"></div>'+
      '<button type="submit" class="btn btn-primary" id="senha-submit">Salvar nova senha</button></form>';
    var sair='<button class="btn btn-dark block perfil-sair" onclick="sairDaConta()">'+IC.logout+' Sair da conta</button>';
    return '<div class="only-desktop pg-head"><h1>Meu perfil</h1></div>'+dados+senha+sair;
  }
  window.trocarSenha = async function(ev){
    ev.preventDefault();
    var nova=document.getElementById("nova-senha").value, conf=document.getElementById("nova-senha-confirma").value;
    var btn=document.getElementById("senha-submit");
    setErro("senha-erro",""); setErro("senha-msg","");
    if(nova.length<6){ setErro("senha-erro","A nova senha precisa ter pelo menos 6 caracteres."); return; }
    if(nova!==conf){ setErro("senha-erro","As senhas não coincidem."); return; }
    btn.disabled=true; btn.textContent="Salvando...";
    try{ var r=await sb.auth.updateUser({password:nova}); if(r.error) throw r.error;
      document.getElementById("nova-senha").value=""; document.getElementById("nova-senha-confirma").value="";
      setErro("senha-msg","Senha alterada com sucesso."); toast("Senha alterada.");
    } catch(err){ console.error(err); setErro("senha-erro",(err&&err.message)||"Não foi possível alterar a senha."); }
    finally{ btn.disabled=false; btn.textContent="Salvar nova senha"; }
  };

  /* =========================================================================
     Navegação
     ========================================================================= */
  var SCREENS={ inicio:screenInicio, aulas:screenAulas, agenda:screenAgenda, solicitacoes:screenSolic, financeiro:screenFinanceiro, perfil:screenPerfil };
  window.ir = function(id){
    tabAtual=id; document.body.setAttribute("data-tab",id);
    document.getElementById("sidebar-nav").innerHTML = NAV.map(function(n){ return '<button class="navitem'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="navitem-ic">'+IC[n.ic]+'</span>'+n.label+'</button>'; }).join("");
    document.getElementById("bottomnav").innerHTML = NAV.map(function(n){ return '<button class="bn-btn'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="bn-ic">'+IC[n.ic]+'</span><span class="bn-lb">'+n.label+'</span></button>'; }).join("");
    renderMHeader();
    var c=document.getElementById("content");
    c.innerHTML='<div class="screen screen-'+id+'">'+ (SCREENS[id]?SCREENS[id]():"") +'</div>';
    c.scrollTop=0;
  };
  function renderAll(){ /* compat: entra pela ir() após login */ }

})();
