// YMT Pricing CRM — shared data function
//
// Stores the live pricing data (list prices, customer deals, temporary
// deals) in Netlify Blobs, the small built-in database Netlify provides —
// no separate signup, API keys, or database service to configure.
//
// GET  /.netlify/functions/data          -> { groupPrices, customerDeals, wholesalerDeals, tempDeals }
// POST /.netlify/functions/data          -> { action, payload } -> applies one change and
//                                            returns the updated slice of data
//
// Reference data (customers, products, SKU groups, sales history) is NOT
// stored here — it's baked directly into index.html and refreshed by
// redeploying the site with a new build, since it only changes weekly.

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'ymt-crm-pricing';

// One-time seed for the `vipContacts` blob, from the Feb'26 customer-list spreadsheet import
// (industry contacts who aren't purchasing outlets themselves — BDMs, category managers,
// wholesaler reps, banner VIP delegates, community club contacts). Only used the very first time
// this endpoint is asked for vipContacts and the blob doesn't exist yet — see readAll() below.
// After that first seed-and-save, this constant is never consulted again; the saved blob is the
// only source of truth, so edits/deletes made via the VIP Contacts tab are never overwritten by
// a future deploy.
const VIP_CONTACTS_SEED = [{"name":"John Hughes","company":"Red Cape Group","role":"Retail Manager","email":"john.hughes@redcape.com.au","phone":"0402519306","source":"On Prem Key Contact","notes":""},{"name":"Todd Kelly","company":"Celleabrations","role":"Retail Manager","email":"todd@aussieworld.com.au","phone":"0411122217","source":"On Prem Key Contact","notes":""},{"name":"Martyn Corrie","company":"Komiskey Group","role":"Retail Manager","email":"stock@comiskey.com.au","phone":"0484 761 683","source":"On Prem Key Contact","notes":""},{"name":"Damien Ringrose","company":"TK Group","role":"Retail Manager","email":"manager@marketwinestore.com.au","phone":"","source":"On Prem Key Contact","notes":""},{"name":"","company":"Darren","role":"","email":"dterlich@lmg.com.au","phone":"","source":"On Prem Key Contact","notes":""},{"name":"Chris Flannery","company":"","role":"","email":"ceo@scfalcons.com.au","phone":"","source":"On Prem Key Contact","notes":""},{"name":"Brad","company":"237 Flinders -","role":"","email":"hello@237flinders.com.au","phone":"0434 009 492","source":"On Prem Key Contact","notes":""},{"name":"Jason Hurford","company":"ALH -","role":"","email":"jason.hurford@alhgroup.com.au","phone":"0459 590 119","source":"On Prem Key Contact","notes":""},{"name":"Pramoth","company":"ALH -","role":"","email":"pramoth.kiriella@alhgroup.com.au","phone":"0413 003 166","source":"On Prem Key Contact","notes":""},{"name":"Stacey Green","company":"ALH -","role":"","email":"stacey.green@alhgroup.com.au","phone":"0417 219 564","source":"On Prem Key Contact","notes":""},{"name":"Alison","company":"ALM Cairns -","role":"","email":"alison.scafidi@metcash.com","phone":"07 4038 7400","source":"On Prem Key Contact","notes":""},{"name":"Jean","company":"ALM Cairns -","role":"","email":"jean-francois.boulle@almliquor.com.au","phone":"07 4038 7400","source":"On Prem Key Contact","notes":""},{"name":"Dean","company":"ALM Mackay -","role":"","email":"dean.szikrai@almliquor.com.au","phone":"0428 930 272","source":"On Prem Key Contact","notes":""},{"name":"Shai","company":"ARE -","role":"","email":"shai.barnes@airportretail.com.au","phone":"0466 415 259","source":"On Prem Key Contact","notes":""},{"name":"Rupesinghe","company":"Arj","role":"","email":"arj.rupesinghe@mantlegroup.com","phone":"0412 553 858","source":"On Prem Key Contact","notes":""},{"name":"Tim","company":"Artesian Hospitality -","role":"","email":"tim.m@artesiancorp.com","phone":"0418 324 493","source":"On Prem Key Contact","notes":""},{"name":"Rick","company":"Aushotels -","role":"","email":"rick@aushotels.net.au","phone":"0424 114 557","source":"On Prem Key Contact","notes":""},{"name":"Ky","company":"Beach Bars -","role":"","email":"","phone":"0492 841 463","source":"On Prem Key Contact","notes":""},{"name":"Adam","company":"Beer Industry Solutions -","role":"","email":"beerindustrysolutions@gmail.com","phone":"0411 880 385","source":"On Prem Key Contact","notes":""},{"name":"Matt","company":"Billy Cart Brewing -","role":"","email":"","phone":"0427 117 648","source":"On Prem Key Contact","notes":""},{"name":"Mick Allwell","company":"Black Sheep -","role":"","email":"","phone":"0432738424","source":"On Prem Key Contact","notes":""},{"name":"Alex","company":"Bluewater -","role":"","email":"","phone":"0417 911 899","source":"On Prem Key Contact","notes":""},{"name":"Matt Coorey","company":"Boardwalk Tavern -","role":"","email":"","phone":"0417 622 968","source":"On Prem Key Contact","notes":""},{"name":"Mossy","company":"BRT -","role":"","email":"thedjmossy@gmail.com","phone":"0405 183 383","source":"On Prem Key Contact","notes":""},{"name":"Joel","company":"Burger Urge -","role":"","email":"joel@burgerurge.com.au","phone":"0420 849 970","source":"On Prem Key Contact","notes":""},{"name":"Jake","company":"Burleigh Pavilion -","role":"","email":"cellar@burleighpavilion.com","phone":"0433 700 198","source":"On Prem Key Contact","notes":""},{"name":"Mike Smith","company":"BWS -","role":"","email":"michael.smith@bws.com.au","phone":"0457 530 690","source":"On Prem Key Contact","notes":""},{"name":"Richard Barnett","company":"BWS -","role":"","email":"richard.barnett@bws.com.au","phone":"0409 079 193","source":"On Prem Key Contact","notes":""},{"name":"Bacon","company":"Cameron","role":"","email":"cameron@thinkservice.com.au","phone":"0416 049 783","source":"On Prem Key Contact","notes":""},{"name":"Whitehead","company":"Cat","role":"","email":"cat.whitehead@yourmatesbrewing.com","phone":"0468 306 871","source":"On Prem Key Contact","notes":""},{"name":"Personal","company":"Cat Whitehead -","role":"","email":"catherinejwhitehead@hotmail.com","phone":"0407 577 789","source":"On Prem Key Contact","notes":""},{"name":"Ross","company":"Caxton -","role":"","email":"","phone":"0418 719 908","source":"On Prem Key Contact","notes":""},{"name":"Josh Hare","company":"Cecil -","role":"","email":"josh@falveyhotels.com","phone":"0411 802 043","source":"On Prem Key Contact","notes":""},{"name":"Moes","company":"Charlie","role":"","email":"charlie.moes@yourmatesbrewing.com","phone":"0478 496 669","source":"On Prem Key Contact","notes":""},{"name":"Personal","company":"Charlie Moes -","role":"","email":"charlie_moes@outlook.com","phone":"0418 984 780","source":"On Prem Key Contact","notes":""},{"name":"","company":"Chill @ Portifino -","role":"","email":"manager@the3kingsgroup.com.au","phone":"0434 551 747","source":"On Prem Key Contact","notes":""},{"name":"Sheehan","company":"Chris","role":"","email":"","phone":"0437 517 688","source":"On Prem Key Contact","notes":""},{"name":"McGarry","company":"Christen","role":"","email":"","phone":"0432 529 306","source":"On Prem Key Contact","notes":""},{"name":"Hahn","company":"Chuck","role":"","email":"Chuck.Hahn@lionco.com","phone":"0418 811 117","source":"On Prem Key Contact","notes":""},{"name":"Alyssia Blewonski","company":"Coles Liquor -","role":"","email":"Alyssia.Blewonski@coles.com.au","phone":"0417 398 120","source":"On Prem Key Contact","notes":""},{"name":"Eamonn","company":"Coles Liquor -","role":"","email":"eamonn.crellin@coles.com.au","phone":"0438500275","source":"On Prem Key Contact","notes":""},{"name":"Katie","company":"Coles Liquor -","role":"","email":"katie.greenleaf@coles.com.au","phone":"0435 213 334","source":"On Prem Key Contact","notes":""},{"name":"Lisa","company":"Coles Liquor -","role":"","email":"lisa.hartnett@coles.com.au","phone":"0427 370 445","source":"On Prem Key Contact","notes":""},{"name":"Craig","company":"Colmslie -","role":"","email":"craig.w@mcguireshotels.com.au","phone":"0404 761 381","source":"On Prem Key Contact","notes":""},{"name":"Steve","company":"Confessions -","role":"","email":"stevemusico@hotmail.com","phone":"0423 248 220","source":"On Prem Key Contact","notes":""},{"name":"Ben Power","company":"Courtyard Cairns -","role":"","email":"manager.cairns@thecyard.com.au","phone":"0428 090 308","source":"On Prem Key Contact","notes":""},{"name":"Steve Stoios","company":"CQ Hotels -","role":"","email":"accountant@cqhg.com.au","phone":"0434 660 667","source":"On Prem Key Contact","notes":""},{"name":"Bron","company":"Crown Hotel Cairns -","role":"","email":"bottleshop@thecrownhotelcairns.com.au","phone":"0439 535 518","source":"On Prem Key Contact","notes":""},{"name":"Gentle","company":"Dan","role":"","email":"","phone":"0402 886 620","source":"On Prem Key Contact","notes":""},{"name":"Margaret","company":"Dan Murphys -","role":"","email":"margaret.odonnell@edg.com.au","phone":"0449 147 001","source":"On Prem Key Contact","notes":""},{"name":"Wayne","company":"Dan Murphys -","role":"","email":"wayne.coombe@danmurphys.com.au","phone":"0408 219 145","source":"On Prem Key Contact","notes":""},{"name":"Kelly","company":"Dap & Co -","role":"","email":"kelly@dapandco.com.au","phone":"0405 807 539","source":"On Prem Key Contact","notes":""},{"name":"Terlich","company":"Darren","role":"","email":"","phone":"0439 494 242","source":"On Prem Key Contact","notes":""},{"name":"Dave","company":"East End Hotel -","role":"","email":"eastendhotel@live.com.au","phone":"0427 557 651","source":"On Prem Key Contact","notes":""},{"name":"Martyn","company":"Eatons Hill -","role":"","email":"stock@comiskey.com.au","phone":"0484 761 683","source":"On Prem Key Contact","notes":""},{"name":"Rob","company":"Emporium -","role":"","email":"rob.brady@emporiumhotels.com.au","phone":"0439 008 966","source":"On Prem Key Contact","notes":""},{"name":"Matt","company":"Farrahs Liquor -","role":"","email":"matt@farrahsliquorcollective.com","phone":"0403 317 692","source":"On Prem Key Contact","notes":""},{"name":"James","company":"Fitzys Toowoomba -","role":"","email":"james@fitzys.com","phone":"0448 884 660","source":"On Prem Key Contact","notes":""},{"name":"Jeremy","company":"Fortitude Music Hall -","role":"","email":"jeremy@thefortitude.com.au","phone":"0423 866 243","source":"On Prem Key Contact","notes":""},{"name":"Mastroianni","company":"Frank","role":"","email":"frank@liquorlogic.com.au","phone":"0409 588 873","source":"On Prem Key Contact","notes":""},{"name":"Janice","company":"Genarri Group -","role":"","email":"","phone":"0416 131 674","source":"On Prem Key Contact","notes":""},{"name":"Craig Martin","company":"George Scott Trading -","role":"","email":"craig.m@georgescottrading.com.au","phone":"0410 632 234","source":"On Prem Key Contact","notes":""},{"name":"Aaron","company":"Ghanem Group -","role":"","email":"aaron@ghanemgroup.com.au","phone":"0434173700","source":"On Prem Key Contact","notes":""},{"name":"Nick","company":"Glen Hotel -","role":"","email":"nickm@glenhotel.com.au","phone":"0431444808","source":"On Prem Key Contact","notes":""},{"name":"Megan","company":"Grainmother NSW -","role":"","email":"","phone":"0488 019 638","source":"On Prem Key Contact","notes":""},{"name":"Morgan","company":"Grant","role":"","email":"","phone":"0438952439","source":"On Prem Key Contact","notes":""},{"name":"Kory","company":"GT\u2019s -","role":"","email":"zatoinptyltd@gmail.com","phone":"0414 509 804","source":"On Prem Key Contact","notes":""},{"name":"Stuart Gordon","company":"Hakfoort Group -","role":"","email":"retail@hgroup.com.au","phone":"07 3213 9613","source":"On Prem Key Contact","notes":""},{"name":"Anna","company":"Hambledon Hotel -","role":"","email":"info@louiesliquor.com.au","phone":"07 4045 9822","source":"On Prem Key Contact","notes":""},{"name":"Mitchell Tudor","company":"IBA -","role":"","email":"mitchell.tudor@almliquor.com.au","phone":"0428 140 573","source":"On Prem Key Contact","notes":""},{"name":"Neil Anderson","company":"IBA -","role":"","email":"neil.anderson@almliquor.com.au","phone":"07 3489 3604","source":"On Prem Key Contact","notes":""},{"name":"Dan Fisher","company":"IBA S/Coast -","role":"","email":"","phone":"0477 961 556","source":"On Prem Key Contact","notes":""},{"name":"Andrew","company":"ILG -","role":"","email":"","phone":"+61 448 735 796","source":"On Prem Key Contact","notes":""},{"name":"Craig","company":"ILG -","role":"","email":"c.stephenson@ilg.com.au","phone":"0434 575 589","source":"On Prem Key Contact","notes":""},{"name":"Justin","company":"ILG -","role":"","email":"j.young@ilg.com.au","phone":"0418 593 978","source":"On Prem Key Contact","notes":""},{"name":"Tracey","company":"ILG -","role":"","email":"T.Rushton@ilg.com.au","phone":"0457 632 814","source":"On Prem Key Contact","notes":""},{"name":"Sam","company":"Irish Murphys -","role":"","email":"sam@nhgroup.com.au","phone":"0408 399 107","source":"On Prem Key Contact","notes":""},{"name":"","company":"Jacko","role":"","email":"damon.jackson@liquidsb.com.au","phone":"0439813697","source":"On Prem Key Contact","notes":""},{"name":"Delany","company":"Jacqui","role":"","email":"jacqui.delaney@liquidsb.com.au","phone":"0409 140 852","source":"On Prem Key Contact","notes":""},{"name":"Rifai","company":"Jedd","role":"","email":"jr@winchestergroup.com.au","phone":"0404 845 390","source":"On Prem Key Contact","notes":""},{"name":"Davies","company":"Jim","role":"","email":"jim@aushotels.net.au","phone":"0408 755 374","source":"On Prem Key Contact","notes":""},{"name":"Maher","company":"Jimmy","role":"","email":"","phone":"0411 534 204","source":"On Prem Key Contact","notes":""},{"name":"Mitesh","company":"Jimmys -","role":"","email":"Mitesh.khristi@mantlegroup.com","phone":"0411 611 155","source":"On Prem Key Contact","notes":""},{"name":"John John","company":"Jubilee -","role":"","email":"john.tereo@tbhotels.com.au","phone":"(07) 3252-4508","source":"On Prem Key Contact","notes":""},{"name":"Charlish","company":"Justin","role":"","email":"justin@redcliffeleagues.com.au","phone":"0417 623 006","source":"On Prem Key Contact","notes":""},{"name":"Gabriel","company":"Kegs Off Tap -","role":"","email":"gabriel@kegsofftap.com.au","phone":"0413 256 106","source":"On Prem Key Contact","notes":""},{"name":"Jake","company":"Kegs Off Tap -","role":"","email":"jake@kegsofftap.com.au","phone":"0413 804 366","source":"On Prem Key Contact","notes":""},{"name":"Craig","company":"Kurrawa SLSC -","role":"","email":"","phone":"0444 522 905","source":"On Prem Key Contact","notes":""},{"name":"Craig","company":"Kurrawa Surf Club -","role":"","email":"","phone":"0413 897 199","source":"On Prem Key Contact","notes":""},{"name":"Craig","company":"Lancer -","role":"","email":"CLyon@lancerbeverage.com","phone":"3414-9700","source":"On Prem Key Contact","notes":""},{"name":"Damian","company":"Last Man Standing -","role":"","email":"dprosser@lmsbrewing.com.au","phone":"0402 270 672","source":"On Prem Key Contact","notes":""},{"name":"Evan","company":"Linville Hotel -","role":"","email":"contact@thelinvillehotel.com.au","phone":"0419 027 903","source":"On Prem Key Contact","notes":""},{"name":"Rick Widt","company":"Lions Den Hotel -","role":"","email":"info@lionsdenhotel.net.au","phone":"0740603911","source":"On Prem Key Contact","notes":""},{"name":"Ben","company":"Liquid Mix -","role":"","email":"ben.murphy@liquidmix.com.au","phone":"0439 960 485","source":"On Prem Key Contact","notes":""},{"name":"Harry","company":"Liquor Legends -","role":"","email":"harry.carmody@liquorlegends.com.au","phone":"","source":"On Prem Key Contact","notes":""},{"name":"James","company":"Liquor Legends -","role":"","email":"james.ms@liquorlegends.com.au","phone":"07 3107 7422","source":"On Prem Key Contact","notes":""},{"name":"John","company":"Liquor Legends -","role":"","email":"john@liquorlegends.com.au","phone":"(07) 3107-7422","source":"On Prem Key Contact","notes":""},{"name":"Kim Edmonds","company":"Liquor Legends -","role":"","email":"kim.edmonds@liquorlegends.com.au","phone":"07 3107 7422","source":"On Prem Key Contact","notes":""},{"name":"Vaughan Peters","company":"Liquor Legends -","role":"","email":"vpeters@liquorlegends.com.au","phone":"0450 929 053","source":"On Prem Key Contact","notes":""},{"name":"Randall","company":"Liquorland -","role":"","email":"randall.drysdale@coles.com.au","phone":"0419 306 520","source":"On Prem Key Contact","notes":""},{"name":"Ben Kizny Gordon","company":"LMG -","role":"","email":"bkiznygordon@lmg.com.au","phone":"02 9475 2303","source":"On Prem Key Contact","notes":""},{"name":"Dave Gyte","company":"LMG -","role":"","email":"dgyte@lmg.com.au","phone":"0737221500","source":"On Prem Key Contact","notes":""},{"name":"Hegs","company":"LMG -","role":"","email":"thegarty@lmg.com.au","phone":"0417 861 074","source":"On Prem Key Contact","notes":""},{"name":"Shannon","company":"Loose Moose -","role":"","email":"deane_designs@yahoo.com","phone":"0417 010 381","source":"On Prem Key Contact","notes":""},{"name":"","company":"Luttsy","role":"","email":"luttsy@nova1069.com.au","phone":"0404 455 055","source":"On Prem Key Contact","notes":""},{"name":"Jess Huddart","company":"Mapleton Pub -","role":"","email":"","phone":"0415 908 417","source":"On Prem Key Contact","notes":""},{"name":"Laura","company":"Mapleton Pub -","role":"","email":"","phone":"0416 585 512","source":"On Prem Key Contact","notes":""},{"name":"Aquino","company":"Mark","role":"","email":"mark.aquino@yourmatesbrewing.com","phone":"","source":"On Prem Key Contact","notes":""},{"name":"Luke","company":"Market Bistro -","role":"","email":"","phone":"0412 201 543","source":"On Prem Key Contact","notes":""},{"name":"Jon","company":"Maroochy RSL -","role":"","email":"jonb@maroochyrsl.com.au","phone":"07 5443 2211","source":"On Prem Key Contact","notes":""},{"name":"Tracey","company":"Maroochy RSL -","role":"","email":"traceyb@maroochyrsl.com.au","phone":"0459 983 799","source":"On Prem Key Contact","notes":""},{"name":"Gurney","company":"Matt","role":"","email":"m.gurney@starliquor.com.au","phone":"0482 850 920","source":"On Prem Key Contact","notes":""},{"name":"Kirkegaard","company":"Matt","role":"","email":"matt@beermatt.com","phone":"(04) 0796-8430","source":"On Prem Key Contact","notes":""},{"name":"Arthur","company":"Matty","role":"","email":"matthew.arthur@diageo.com","phone":"0421 056 646","source":"On Prem Key Contact","notes":""},{"name":"Damian","company":"McGuires -","role":"","email":"damian@mcguireshotels.com.au","phone":"0412 372 222","source":"On Prem Key Contact","notes":""},{"name":"Matt","company":"McGuires -","role":"","email":"matt@mcguireshotels.com.au","phone":"0400 404 442","source":"On Prem Key Contact","notes":""},{"name":"","company":"Midge","role":"","email":"lyal.midgley@gmail.com","phone":"3855-9325","source":"On Prem Key Contact","notes":""},{"name":"Edwards","company":"Mike","role":"","email":"mike@yourmatesbrewing.com","phone":"0422 711 251","source":"On Prem Key Contact","notes":""},{"name":"Matt","company":"Miss Kays -","role":"","email":"matt.lee@misskays.com.au","phone":"0413 901 639","source":"On Prem Key Contact","notes":""},{"name":"Richie","company":"Miss Margarita -","role":"","email":"richard@missmargarita.com.au","phone":"0434 978 509","source":"On Prem Key Contact","notes":""},{"name":"Ben","company":"Miss Moneypennys -","role":"","email":"","phone":"0418 462 708","source":"On Prem Key Contact","notes":""},{"name":"Mark","company":"Monkey Tree -","role":"","email":"","phone":"0466 270 839","source":"On Prem Key Contact","notes":""},{"name":"Bryan","company":"Mooloolaba Surf Club -","role":"","email":"Bryan@thesurfclub.com.au","phone":"0409 364 648","source":"On Prem Key Contact","notes":""},{"name":"Simon","company":"Mooloolaba Surf Club -","role":"","email":"simon@thesurfclub.com.au","phone":"0410 437 933","source":"On Prem Key Contact","notes":""},{"name":"Kristy","company":"Moto Bar -","role":"","email":"","phone":"0424 020 401","source":"On Prem Key Contact","notes":""},{"name":"Simon","company":"N17 Port Douglas -","role":"","email":"","phone":"0412 005 338","source":"On Prem Key Contact","notes":""},{"name":"Moggy","company":"Noosa SLSC -","role":"","email":"noosasurf@hotmail.com","phone":"07 5447 2355","source":"On Prem Key Contact","notes":""},{"name":"Craig","company":"North Lakes Sports -","role":"","email":"craig@northlakessports.com.au","phone":"0402 465 415","source":"On Prem Key Contact","notes":""},{"name":"Digs","company":"Norton Hospitality -","role":"","email":"adam@nhgroup.com.au","phone":"0411 080 727","source":"On Prem Key Contact","notes":""},{"name":"Louise","company":"On Tap -","role":"","email":"louisej@ontapdata.com.au","phone":"0416 113 264","source":"On Prem Key Contact","notes":""},{"name":"Richo","company":"Osbourne Hotel -","role":"","email":"richard@osbournehotel.com.au","phone":"0414 298 696","source":"On Prem Key Contact","notes":""},{"name":"Chuggy","company":"Paddo -","role":"","email":"paddomanagers@mcguireshotels.com.au","phone":"0405 616 897","source":"On Prem Key Contact","notes":""},{"name":"Adam","company":"Paramount -","role":"","email":"adamt@paramountliquor.com.au","phone":"0403 244 354","source":"On Prem Key Contact","notes":""},{"name":"Anthony","company":"Paramount -","role":"","email":"anthony@paramountliquor.com.au","phone":"0403 206 255","source":"On Prem Key Contact","notes":""},{"name":"Belinda","company":"Paramount -","role":"","email":"Belinda.McCormick@liquidsb.com.au","phone":"07 3384 0402","source":"On Prem Key Contact","notes":""},{"name":"Bobby","company":"Paramount -","role":"","email":"bobby.monro@paramountliquor.com.au","phone":"0488 785 140","source":"On Prem Key Contact","notes":""},{"name":"Chelsea","company":"Paramount -","role":"","email":"","phone":"0456 677 880","source":"On Prem Key Contact","notes":""},{"name":"Davina","company":"Paramount -","role":"","email":"","phone":"07 3384 0408","source":"On Prem Key Contact","notes":""},{"name":"Michael Carty","company":"Paramount -","role":"","email":"michaelc@paramountliquor.com.au","phone":"0417 265 847","source":"On Prem Key Contact","notes":""},{"name":"Stephen","company":"Paramount -","role":"","email":"stephen.may@paramountliquor.com.au","phone":"0498 665 926","source":"On Prem Key Contact","notes":""},{"name":"Isaak","company":"Paramount FNQ -","role":"","email":"isaakh@paramountliquor.com.au","phone":"0456 109 968","source":"On Prem Key Contact","notes":""},{"name":"Cameron Flett","company":"Paramount Newcastle -","role":"","email":"cameronf@paramountliquor.com.au","phone":"0437 907 875","source":"On Prem Key Contact","notes":""},{"name":"Donohue","company":"Pat","role":"","email":"patrick.donohue@lionco.com","phone":"0408 736 380","source":"On Prem Key Contact","notes":""},{"name":"LeCarpentier","company":"Paul","role":"","email":"","phone":"07 5446 2600","source":"On Prem Key Contact","notes":""},{"name":"McMahon","company":"Paul","role":"","email":"mossmanhotel@commander.net.au","phone":"0418 995 683","source":"On Prem Key Contact","notes":""},{"name":"Shane Hep","company":"Pavilion -","role":"","email":"","phone":"0410 442 809","source":"On Prem Key Contact","notes":""},{"name":"Davis","company":"Pete","role":"","email":"","phone":"0417 593 044","source":"On Prem Key Contact","notes":""},{"name":"Marchant","company":"Peter","role":"","email":"peter@fandagroup.com.au","phone":"0431 015 772","source":"On Prem Key Contact","notes":""},{"name":"McFarland","company":"Peter","role":"","email":"peter@sunhotelgroup.com.au","phone":"0418 309 916","source":"On Prem Key Contact","notes":""},{"name":"Jack","company":"Pig N Whistle -","role":"","email":"jack.nicholson@mantlegroup.com","phone":"0401 756 732","source":"On Prem Key Contact","notes":""},{"name":"Liam","company":"Pig N Whistle -","role":"","email":"liam.armstrong@pignwhistle.com.au","phone":"0416 040 635","source":"On Prem Key Contact","notes":""},{"name":"Paul","company":"Pig N Whistle -","role":"","email":"peabeau@live.com.au","phone":"0423 606 480","source":"On Prem Key Contact","notes":""},{"name":"Singo","company":"Piney -","role":"","email":"craig@pineapplehotel.com.au","phone":"0408 911 187","source":"On Prem Key Contact","notes":""},{"name":"Tony","company":"Piney -","role":"","email":"tony@pineapplehotel.com.au","phone":"0438 172 260","source":"On Prem Key Contact","notes":""},{"name":"Jamie","company":"Pinnacle Hotel -","role":"","email":"","phone":"0438 282 974","source":"On Prem Key Contact","notes":""},{"name":"Jason","company":"Pitchers -","role":"","email":"jason@pitchers.com.au","phone":"0408 708 886","source":"On Prem Key Contact","notes":""},{"name":"Sharlene","company":"Pizzami -","role":"","email":"Mckennasharlene@gmail.com","phone":"0407 343 816","source":"On Prem Key Contact","notes":""},{"name":"Peter Ritchie","company":"Premier Motors -","role":"","email":"","phone":"07 5437 6633","source":"On Prem Key Contact","notes":""},{"name":"Alex","company":"Prince Consort -","role":"","email":"alex@theprinceconsort.com.au","phone":"0407 080 513","source":"On Prem Key Contact","notes":""},{"name":"Jason","company":"Prince Consort -","role":"","email":"jason@tilleyandwills.com","phone":"0478 564 260","source":"On Prem Key Contact","notes":""},{"name":"Kahlia","company":"Punsand Bay -","role":"","email":"Kahlia@capeyorkcamping.com.au","phone":"0423 189 705","source":"On Prem Key Contact","notes":""},{"name":"Paul","company":"Push Productions -","role":"","email":"pmorton@pushproductions.com.au","phone":"07 5476 631","source":"On Prem Key Contact","notes":""},{"name":"Pieman","company":"Pyney","role":"","email":"pyneyspiereviews@gmail.com","phone":"0400 780 580","source":"On Prem Key Contact","notes":""},{"name":"Josh Jones","company":"QFE -","role":"","email":"josh@thedoonan.com.au","phone":"0414 714 701","source":"On Prem Key Contact","notes":""},{"name":"Damien Steele","company":"QHA -","role":"","email":"","phone":"0422 282 781","source":"On Prem Key Contact","notes":""},{"name":"Kelly-Anne","company":"QHA -","role":"","email":"kmott@qha.org.au","phone":"0407 167 008","source":"On Prem Key Contact","notes":""},{"name":"Paul St John Wood","company":"QHA -","role":"","email":"paul@qha.org.au","phone":"07 3221 6999","source":"On Prem Key Contact","notes":""},{"name":"Simon Cross","company":"QHA Review -","role":"","email":"","phone":"0413 698 630","source":"On Prem Key Contact","notes":""},{"name":"Cade","company":"Quench Liquor -","role":"","email":"cbooth@quenchliquor.com.au","phone":"433 533 006","source":"On Prem Key Contact","notes":""},{"name":"Dave","company":"Red Beret -","role":"","email":"drive@theredberet.com.au","phone":"0408 680 443","source":"On Prem Key Contact","notes":""},{"name":"Michael","company":"Red Bull -","role":"","email":"","phone":"0478 881 378","source":"On Prem Key Contact","notes":""},{"name":"Steve","company":"Red Bull -","role":"","email":"steve.zagari@redbull.com","phone":"02 9023 2800","source":"On Prem Key Contact","notes":""},{"name":"Bruce Spannagle","company":"Reef Gateway -","role":"","email":"bruce.spannagle@ausvenueco.com.au","phone":"0488 471 106","source":"On Prem Key Contact","notes":""},{"name":"Chris","company":"Reef Seafood -","role":"","email":"manager@reefgasworks.com","phone":"0402 173 238","source":"On Prem Key Contact","notes":""},{"name":"Mike","company":"Regatta -","role":"","email":"storeman.regattahotel@ausvenueco.com.au","phone":"0429 355 577","source":"On Prem Key Contact","notes":""},{"name":"Les","company":"RG 's -","role":"","email":"rghotel@bigpond.com","phone":"0732524870","source":"On Prem Key Contact","notes":""},{"name":"Bec","company":"RG's -","role":"","email":"bec@royalgeorgehotel.com.au","phone":"0439 701 101","source":"On Prem Key Contact","notes":""},{"name":"Elyza","company":"Riceboi -","role":"","email":"elyza@riceboi.com.au","phone":"0410 817 742","source":"On Prem Key Contact","notes":""},{"name":"Gazzard","company":"Rick","role":"","email":"rickgazzard@bigpond.com","phone":"0418 179 225","source":"On Prem Key Contact","notes":""},{"name":"","company":"Ringers","role":"","email":"manager@marketwinestore.com.au","phone":"0413 101 163","source":"On Prem Key Contact","notes":""},{"name":"Scott","company":"Rivercity -","role":"","email":"scott@rivercity.com.au","phone":"0430 321 185","source":"On Prem Key Contact","notes":""},{"name":"Shane","company":"Rivercity -","role":"","email":"sales@rivercity.com.au","phone":"0478 650 930","source":"On Prem Key Contact","notes":""},{"name":"Sam","company":"Rivercity Wholesalers -","role":"","email":"info@rivercity.com.au","phone":"3875-2636","source":"On Prem Key Contact","notes":""},{"name":"Shane","company":"Rivershore -","role":"","email":"SSutton@ingeniacommunities.com.au","phone":"0406 767 652","source":"On Prem Key Contact","notes":""},{"name":"Callum","company":"Road Crew -","role":"","email":"","phone":"0433 618 540","source":"On Prem Key Contact","notes":""},{"name":"Henry","company":"Road Crew -","role":"","email":"","phone":"0432 630 080","source":"On Prem Key Contact","notes":""},{"name":"Jay Bastardo","company":"Road Crew -","role":"","email":"saint-jay@hotmail.com","phone":"0422 042 251","source":"On Prem Key Contact","notes":""},{"name":"Jonathan","company":"Road Crew -","role":"","email":"jmacekaff@gmail.com","phone":"0432 235 969","source":"On Prem Key Contact","notes":""},{"name":"Kylie","company":"Road Crew -","role":"","email":"kasalter82@gmail.com","phone":"0409 245 552","source":"On Prem Key Contact","notes":""},{"name":"Comiskey","company":"Rob","role":"","email":"Rob@comiskey.com.au","phone":"0407 522 298","source":"On Prem Key Contact","notes":""},{"name":"Van Delft","company":"Rob","role":"","email":"rob.vandelft@yourmatesbrewing.com","phone":"0434 657 166","source":"On Prem Key Contact","notes":""},{"name":"Christian","company":"Robina Pavilion -","role":"","email":"bar@robinapavilion.com.au","phone":"0414 994 993","source":"On Prem Key Contact","notes":""},{"name":"Sam Ingham Myers","company":"Rocklea Hotel -","role":"","email":"sam@inghammyershotels.com","phone":"0400 693 770","source":"On Prem Key Contact","notes":""},{"name":"Topley","company":"Rohan","role":"","email":"rohan@gamingenterprises.com.au","phone":"0419 223 333","source":"On Prem Key Contact","notes":""},{"name":"Kyiesha","company":"Sandstone Events -","role":"","email":"events@sandstonepointhotel.com.au","phone":"0478 081 784","source":"On Prem Key Contact","notes":""},{"name":"Brad","company":"Sandstone Point -","role":"","email":"gm@sandstonepointhotel.com.au","phone":"0417 050 878","source":"On Prem Key Contact","notes":""},{"name":"Kieran","company":"Sandstone Point -","role":"","email":"ops@sandstonepointhotel.com.au","phone":"0411 342 940","source":"On Prem Key Contact","notes":""},{"name":"Armstrong","company":"Scott","role":"","email":"scott@maevahospitality.com.au","phone":"0418 642 339","source":"On Prem Key Contact","notes":""},{"name":"Gordy","company":"Seabreeze Mackay -","role":"","email":"Gordy.Bradley@seebreezehotelmackay.com.au","phone":"0422 271 122","source":"On Prem Key Contact","notes":""},{"name":"King","company":"Shane","role":"","email":"","phone":"0405 104 855","source":"On Prem Key Contact","notes":""},{"name":"Currey","company":"Sid","role":"","email":"sidrancho@gmail.com","phone":"0435 591 012","source":"On Prem Key Contact","notes":""},{"name":"Alex","company":"Sol Bar -","role":"","email":"alex@solbar.com.au","phone":"0413 468 490","source":"On Prem Key Contact","notes":""},{"name":"Kobi","company":"Sol Bar -","role":"","email":"","phone":"0423 361 034","source":"On Prem Key Contact","notes":""},{"name":"George","company":"Star Liquor -","role":"","email":"zone3@starliquor.com.au","phone":"","source":"On Prem Key Contact","notes":""},{"name":"Jon","company":"Star Liquor -","role":"","email":"j.fields@starliquor.com.au","phone":"07 3414 1200","source":"On Prem Key Contact","notes":""},{"name":"Mark Holden","company":"Star Liquor -","role":"","email":"mbhliquordirect@starliquor.com.au","phone":"0427 921 829","source":"On Prem Key Contact","notes":""},{"name":"Rodney Hunter","company":"Star Liquor -","role":"","email":"rodney@starhotels.com.au","phone":"07 3414 1227","source":"On Prem Key Contact","notes":""},{"name":"Prosser","company":"Steve","role":"","email":"sprosser@lmsbrewing.com.au","phone":"0450 046 780","source":"On Prem Key Contact","notes":""},{"name":"Bensley","company":"Stewart","role":"","email":"","phone":"0429448523","source":"On Prem Key Contact","notes":""},{"name":"Ross","company":"Stone & Wood -","role":"","email":"ross@stoneandwood.com.au","phone":"(02) 6685-5173","source":"On Prem Key Contact","notes":""},{"name":"Gordon","company":"Story Bridge Hotel -","role":"","email":"gordonjones@storybridgehotel.com.au","phone":"0409 345 362","source":"On Prem Key Contact","notes":""},{"name":"Jo","company":"Story Bridge Hotel -","role":"","email":"joannecosgrove@storybridgehotel.com.au","phone":"0434 962 187","source":"On Prem Key Contact","notes":""},{"name":"Richard","company":"Story Bridge Hotel -","role":"","email":"richarddeery@storybridgehotel.com.au","phone":"0417 034 495","source":"On Prem Key Contact","notes":""},{"name":"Mark","company":"Straddie Pub -","role":"","email":"mark@accredo.net.au","phone":"0417 421 022","source":"On Prem Key Contact","notes":""},{"name":"Dave Newbury","company":"Suncoast Hotels -","role":"","email":"dave@maevahospitality.com.au","phone":"0407 308 927","source":"On Prem Key Contact","notes":""},{"name":"Rob","company":"Suncoast Hotels -","role":"","email":"rob@maevahospitality.com.au","phone":"0407 258 253","source":"On Prem Key Contact","notes":""},{"name":"Matt Hobson","company":"Sunshine & Sons -","role":"","email":"","phone":"0414 885 775","source":"On Prem Key Contact","notes":""},{"name":"Michael","company":"Sunshine & Sons -","role":"","email":"","phone":"0414 624 907","source":"On Prem Key Contact","notes":""},{"name":"Ty Foster","company":"Sunshine & Sons -","role":"","email":"","phone":"0428 614 040","source":"On Prem Key Contact","notes":""},{"name":"Michael","company":"Sunshine Coast Stadium -","role":"","email":"michael.singh@sunshinecoast.qld.gov.au","phone":"0447 020 607","source":"On Prem Key Contact","notes":""},{"name":"David","company":"Taphouse Kingscliff -","role":"","email":"david.bell@taphouse.com.au","phone":"0411 689 539","source":"On Prem Key Contact","notes":""},{"name":"Kirsty","company":"TB\u2019s","role":"","email":"kirsty@tbhotels.com.au","phone":"0410 255 461","source":"On Prem Key Contact","notes":""},{"name":"Shane","company":"TB\u2019s Retail -","role":"","email":"shane@tbhotels.com.au","phone":"0426 262 680","source":"On Prem Key Contact","notes":""},{"name":"Morrow","company":"Terry","role":"","email":"landspub@bigpond.net.au","phone":"0418 157 732","source":"On Prem Key Contact","notes":""},{"name":"Tim Lucas","company":"The Dock -","role":"","email":"tim@kickongroup.com","phone":"0499 800 009","source":"On Prem Key Contact","notes":""},{"name":"Joe","company":"The Point -","role":"","email":"arm@thepointbrisbane.com.au","phone":"0498 975 116","source":"On Prem Key Contact","notes":""},{"name":"Chris","company":"The Station -","role":"","email":"chris@streetcollective.com.au","phone":"0400 015 511","source":"On Prem Key Contact","notes":""},{"name":"Craig","company":"The Station -","role":"","email":"","phone":"0413 463 731","source":"On Prem Key Contact","notes":""},{"name":"Finn","company":"The Station -","role":"","email":"","phone":"0428 881 528","source":"On Prem Key Contact","notes":""},{"name":"Adam","company":"Tin Shed -","role":"","email":"info@thetinshed-portdouglas.com.au","phone":"0410 457 471","source":"On Prem Key Contact","notes":""},{"name":"Clayton","company":"Todd","role":"","email":"todd@5boroughs.com.au","phone":"0409 060 033","source":"On Prem Key Contact","notes":""},{"name":"Forrest","company":"Todd","role":"","email":"","phone":"0439 112 522","source":"On Prem Key Contact","notes":""},{"name":"Widdicombe","company":"Todd","role":"","email":"","phone":"0477 887 300","source":"On Prem Key Contact","notes":""},{"name":"Burnett","company":"Tony","role":"","email":"tony@tbhotels.com.au","phone":"0438 041 468","source":"On Prem Key Contact","notes":""},{"name":"Chow","company":"Torquay Hotel -","role":"","email":"torquaysuperstore@gmail.com","phone":"0412 737 319","source":"On Prem Key Contact","notes":""},{"name":"James","company":"UK Hotel Bendigo -","role":"","email":"oldcrownbendigo@outlook.com","phone":"0498 800 846","source":"On Prem Key Contact","notes":""},{"name":"Clint","company":"UQ -","role":"","email":"","phone":"0438 132 725","source":"On Prem Key Contact","notes":""},{"name":"Jay Baird","company":"Vintage Cellars -","role":"","email":"jay.baird@coles.com.au","phone":"0428 921 679","source":"On Prem Key Contact","notes":""},{"name":"Ruma","company":"Vintage Cellars -","role":"","email":"ruma.alag@coles.com.au","phone":"0468 674 798","source":"On Prem Key Contact","notes":""},{"name":"Tiller","company":"Wade","role":"","email":"wade@getfizzy.co","phone":"0418 153 264","source":"On Prem Key Contact","notes":""},{"name":"Frank & Deb","company":"Walkabout Creek -","role":"","email":"walkaboutcreekhotel@bigpond.com","phone":"07 4746 8424","source":"On Prem Key Contact","notes":""},{"name":"Glenn","company":"Waymark -","role":"","email":"glenn.willoughby@waymarkhotels.com.au","phone":"0409 840 383","source":"On Prem Key Contact","notes":""},{"name":"Tim","company":"Waymark -","role":"","email":"tim.velema@waymarkhotels.com.au","phone":"0414 154 265","source":"On Prem Key Contact","notes":""},{"name":"Scott Hogan","company":"Wello Point -","role":"","email":"","phone":"0417 764 674","source":"On Prem Key Contact","notes":""},{"name":"Mark","company":"Woombye Pub -","role":"","email":"info@thewoombyepub.com.au","phone":"0439 006 776","source":"On Prem Key Contact","notes":""},{"name":"Sophie","company":"Yamba Shores Tavern -","role":"","email":"bottleshop@yambashorestavern.com.au","phone":"0430 272 776","source":"On Prem Key Contact","notes":""},{"name":"Curly","company":"Young Henrys -","role":"","email":"","phone":"0421 699 962","source":"On Prem Key Contact","notes":""},{"name":"Dan","company":"Young Henrys -","role":"","email":"dan@younghenrys.com","phone":"0423 700 899","source":"On Prem Key Contact","notes":""},{"name":"Amy","company":"Your Mates -","role":"","email":"amy.shelford@yourmatesbrewing.com","phone":"0447 680 031","source":"On Prem Key Contact","notes":""},{"name":"Brent","company":"Your Mates -","role":"","email":"","phone":"0401 341 005","source":"On Prem Key Contact","notes":""},{"name":"Brett","company":"Your Mates -","role":"","email":"","phone":"0407 150 692","source":"On Prem Key Contact","notes":""},{"name":"Brewpub","company":"Your Mates -","role":"","email":"","phone":"07 5353 0971","source":"On Prem Key Contact","notes":""},{"name":"Chriso","company":"Your Mates -","role":"","email":"","phone":"0406 367 964","source":"On Prem Key Contact","notes":""},{"name":"Corinne","company":"Your Mates -","role":"","email":"","phone":"0414 290 673","source":"On Prem Key Contact","notes":""},{"name":"Holly","company":"Your Mates -","role":"","email":"","phone":"0451 138 847","source":"On Prem Key Contact","notes":""},{"name":"Issi","company":"Your Mates -","role":"","email":"","phone":"0432 399 892","source":"On Prem Key Contact","notes":""},{"name":"Jemma","company":"Your Mates -","role":"","email":"","phone":"0431 797 712","source":"On Prem Key Contact","notes":""},{"name":"Josh","company":"Your Mates -","role":"","email":"","phone":"0412 543 798","source":"On Prem Key Contact","notes":""},{"name":"Kelly","company":"Your Mates -","role":"","email":"","phone":"0449 251 508","source":"On Prem Key Contact","notes":""},{"name":"Lara","company":"Your Mates -","role":"","email":"","phone":"0401 639 624","source":"On Prem Key Contact","notes":""},{"name":"Mark","company":"Your Mates -","role":"","email":"mark.aquino@yourmatesbrewing.com","phone":"0416 158 825","source":"On Prem Key Contact","notes":""},{"name":"Raymond","company":"Your Mates -","role":"","email":"raymond.vonder@yourmatesbrewing.com","phone":"0456 630 082","source":"On Prem Key Contact","notes":""},{"name":"Reception","company":"Your Mates -","role":"","email":"","phone":"07 5329 4733","source":"On Prem Key Contact","notes":""},{"name":"Rob Naylor","company":"Your Mates -","role":"","email":"rob.naylor@yourmatesbrewing.com","phone":"0413 058 266","source":"On Prem Key Contact","notes":""},{"name":"Ryan","company":"Your Mates -","role":"","email":"","phone":"0412 042 118","source":"On Prem Key Contact","notes":""},{"name":"Sharni","company":"Your Mates -","role":"","email":"","phone":"0421 276 897","source":"On Prem Key Contact","notes":""},{"name":"Tim","company":"Your Mates -","role":"","email":"","phone":"0481 388 565","source":"On Prem Key Contact","notes":""},{"name":"Will","company":"Your Mates -","role":"","email":"","phone":"0412 408 947","source":"On Prem Key Contact","notes":""},{"name":"Margaret O'Donnell","company":"Endevour Group","role":"Assistant Category Manager Dan Murphys","email":"margaret.odonnell@edg.com.au","phone":"0449 147 001","source":"National Account Contact","notes":"Going through chemo for breast cancer and has Wednesdays off. Promo's slotted until early 2026."},{"name":"Anna Ressig","company":"Endevour Group","role":"Assistant Category Manager Range","email":"","phone":"0408 170 816","source":"National Account Contact","notes":"Ranging in both Dan Murphys & BWS"},{"name":"Fernando Fernandes","company":"Endevour Group","role":"Category Manager Beer & Cider Range","email":"fernando.fernandes@edg.com.au","phone":"0414 949 529","source":"National Account Contact","notes":""},{"name":"Hugh Smith","company":"Endevour Group","role":"Assistant Category Manager Local (Range)","email":"hugh.smith@edg.com.au","phone":"0415 046 096","source":"National Account Contact","notes":"Local Ranging in both Dan Murphys & BWS"},{"name":"Noah Nakhle","company":"Endevour Group","role":"Assistant Category Manager BWS","email":"noah.nakhle@edg.com.au","phone":"","source":"National Account Contact","notes":"Promotions in BWS. I have submitted promotions up to early 2026, but can altered if required."},{"name":"Liv Whyte","company":"Coles Liquor Group","role":"Assistant Category Manager Craft","email":"olivia.whyte@coles.com.au","phone":"0466 631 172","source":"National Account Contact","notes":"Promotions and slotting for First Choice, Liquorland and Vintage Cellars, but not Ginger Beer"},{"name":"Gemma Wilson-Dunleavy","company":"Coles Liquor Group","role":"Category Manager Craft","email":"Gemma.Wilson-Dunleavy@coles.com.au","phone":"0435 622 896","source":"National Account Contact","notes":"Promotions and slotting for First Choice, Liquorland and Vintage Cellars, but not Ginger Beer"},{"name":"Zoe Price","company":"Coles Liquor Group","role":"Assistant Category Manager Craft","email":"zoe.price@coles.com.au","phone":"","source":"National Account Contact","notes":"Assists Gemma with promotional planning etc"},{"name":"Peter Crowther","company":"Coles Liquor Group","role":"Assistant Category Manager Ginger Beer","email":"peter.crowther1@coles.com.au","phone":"0461 400 228","source":"National Account Contact","notes":"Promotion planning and pricing for Ginger Beer. New pricing locked in from May."},{"name":"Harry Carmody","company":"Liquor Legends","role":"Category Manager Beer & Cider","email":"Harry.Carmody@liquorlegends.com.au","phone":"0447432398","source":"Independent Banner Contact","notes":""},{"name":"Patrick Lehmann","company":"Liquor Legends","role":"Category Manager Ginger Beer","email":"patrick.lehmann@liquorlegends.com.au","phone":"07 3107 7422","source":"Independent Banner Contact","notes":""},{"name":"Ben Brock","company":"Value Liquor Group","role":"Category Manager","email":"ben.brock@valueliquorgroup.com.au","phone":"0408700792","source":"Independent Banner Contact","notes":""},{"name":"Emily Muller","company":"Star Liquor","role":"General Manager / Promotions","email":"e.muller@starhotels.com.au","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Matt Gurney","company":"Star Liquor","role":"Promotions Coordinator","email":"M.gurney@starliquor.com.au","phone":"0482 850 920","source":"Independent Banner Contact","notes":""},{"name":"Neil Anderson","company":"ALM","role":"IBA Business Manager Qld","email":"Neil.Anderson@almliquor.com.au","phone":"0427 991 795","source":"Independent Banner Contact","notes":""},{"name":"Colin Olson","company":"IBA Super Stores","role":"IBA Retail Operations Coordinator - Superstores","email":"Colin1.Olson@almliquor.com.au","phone":"07 3489 3643","source":"Independent Banner Contact","notes":""},{"name":"Kain Moore","company":"Thirsty Camel","role":"Business Manager Thirtsy Camel Tas, QLD, NSW","email":"Kain.Moore@almliquor.com.au","phone":"0418 552 109","source":"Independent Banner Contact","notes":""},{"name":"Michael Hofman | Category \u2013 Key Retail Planner","company":"IBA Super Stores","role":"","email":"michael.hofman@almliquor.com.au","phone":"0491 335 126","source":"Independent Banner Contact","notes":""},{"name":"Tony Munn","company":"Thirsty Camel","role":"Promos","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Denise Sharpe","company":"ALM","role":"Promotional Coordinator BottleO and IGABeer & Cider","email":"denise.sharpe@almliquor.com.au","phone":"0408 114 823","source":"Independent Banner Contact","notes":""},{"name":"Meg Bolli","company":"ALM","role":"IBA Key Retail Planner Beer & Cider","email":"meg.bolli@almliquor.com.au","phone":"0474 358 893","source":"Independent Banner Contact","notes":""},{"name":"Martin Roberts","company":"IBA","role":"Catergory Manager Beer & Cider","email":"martin.roberts@almliquor.com.au","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Michael Hofman","company":"IBA","role":"Key Retail Planner/ Beer&Cider","email":"michael.hofman@almliquor.com.au","phone":"0491 335 126","source":"Independent Banner Contact","notes":""},{"name":"Randall Wolfgramm","company":"Liquor Marketing Group","role":"Category Manager Beer & Cider","email":"rwolfgramm@lmg.com.au","phone":"0434 844 013","source":"Independent Banner Contact","notes":""},{"name":"Michael Latham","company":"Liquor Marketing Group","role":"Assistand Category Manager Beer & Cider","email":"mlatham@lmg.com.au","phone":"0432 161 046","source":"Independent Banner Contact","notes":""},{"name":"Darren Terlich","company":"Liquor Marketing Group","role":"Retail Ops Manager","email":"","phone":"0439 494 242","source":"Independent Banner Contact","notes":""},{"name":"Duncan MacDonald","company":"Indepdent Liquor Retailers","role":"Catergory Manager","email":"Duncan.macdonald@ilr.net.au","phone":"0498 322 177","source":"Independent Banner Contact","notes":"Pricing and promo's for ILR/Local Liquor. Small ranging, slotted EDP pricing."},{"name":"Laura Campbell","company":"Rebel Liquor","role":"Promotions Co-ordinator","email":"laura@rlqld.com.au","phone":"0488 220 126","source":"Independent Banner Contact","notes":"Cheers Liquor and Liquor Warehouse. Very small group."},{"name":"Supplier Confirmations & Jotforms","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Tom Walsh \u2013 thomas.walsh@metcash.com","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Promotional Program \u2013 Updates to slotting board, product additions/deletions, RRP pricing, Camel Cash/Loyalty activity, Key Retail process","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Callie Davis - callie1.davis@metcash.com","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Tanya O\u2019Connor - tanya.oconnor@almliquor.com.au","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"E-Commerce","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Tom Walsh \u2013 Tom.Walsh@metcash.com","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Loyalty ( Hump Club and Camel Card)","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Kate Butcher - kate.butcher@metcash.com","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Marketing","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Member Services \u2013 Tasmania & New South Wales","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Alison Anderson - alison.anderson@almliquor.com.au","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Member Services \u2013 South Australia & Northern Territory","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Member Services \u2013 Queensland","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Rachael Hanley - rachael.hanley@almliquor.com.au","company":"Thirsty Camel","role":"","email":"","phone":"","source":"Independent Banner Contact","notes":""},{"name":"Stuart Etcell","company":"ILG","role":"Category Manager Beer","email":"s.etcell@ilg.com.au","phone":"0473 610 015","source":"Independent Banner Contact","notes":"Little Bottler, Fleet Street and Super Cellars"},{"name":"Bobby Monro","company":"Paramount Liquor","role":"3PL Trading Manager","email":"bobby.monro@paramountliquor.com.au","phone":"0488 785 140","source":"Wholesaler Rep Contact","notes":"The go to person for all stock, freight and pricing enquiries."},{"name":"Jacqui Delaney","company":"Paramount Liquor","role":"State Sales Manager","email":"jacqui.delaney@paramountliquor.com.au","phone":"0409 140 852","source":"Wholesaler Rep Contact","notes":"Looks after the Paramount sales team and best contact for customer related enquiries"},{"name":"Rylee Martin","company":"ALM","role":"National On prem Exec","email":"rylee.martin@almliquor.com.au","phone":"61 421 075 372","source":"Wholesaler Rep Contact","notes":""},{"name":"Brendan","company":"ALM Cairns -","role":"","email":"brendan.barry@almliquor.com.au","phone":"0409 723 848","source":"Wholesaler Rep Contact","notes":""},{"name":"Aaron Mullan","company":"Kerwick Hotel","role":"Delegate","email":"afmullan@gmail.com","phone":"0420762771","source":"Liquor Legends VIP","notes":""},{"name":"Scott Grills","company":"Kerwick Hotel","role":"Delegate","email":"afmullan@gmail.com","phone":"0420762771","source":"Liquor Legends VIP","notes":""},{"name":"Andrew Ford","company":"The Lakehouse","role":"Delegate","email":"aford11429@yahoo.com","phone":"0428353729","source":"Liquor Legends VIP","notes":""},{"name":"Andrew Thompson","company":"Stafford Tavern","role":"Delegate","email":"athomp92@hotmail.com","phone":"0432368174","source":"Liquor Legends VIP","notes":""},{"name":"Barry Fitzgibbons","company":"Logan City Tavern & Drive Thru","role":"Delegate","email":"bfitzgibbons@fhlgroup.com.au","phone":"0439667963","source":"Liquor Legends VIP","notes":""},{"name":"Pamela Diffey","company":"Logan City Tavern & Drive Thru","role":"Delegate","email":"bfitzgibbons@fhlgroup.com.au","phone":"0439667963","source":"Liquor Legends VIP","notes":""},{"name":"Ben OMalley","company":"Eagle Tavern","role":"Delegate","email":"bomalley@edphotels.com.au","phone":"0419177197","source":"Liquor Legends VIP","notes":""},{"name":"Shannon Martin","company":"Eagle Tavern","role":"Delegate","email":"bomalley@edphotels.com.au","phone":"0419177197","source":"Liquor Legends VIP","notes":""},{"name":"Ben Shannon","company":"Highland Park Tavern","role":"Delegate","email":"rgm@goodtimespubgroup.com.au","phone":"0408510545","source":"Liquor Legends VIP","notes":""},{"name":"Harry Kennedy Ripon","company":"Highland Park Tavern","role":"Delegate","email":"rgm@goodtimespubgroup.com.au","phone":"0408510545","source":"Liquor Legends VIP","notes":""},{"name":"Cameron McPhie","company":"Mayfair Ridge Tavern","role":"Delegate","email":"cameron@mcphie.com.au","phone":"0403736113","source":"Liquor Legends VIP","notes":""},{"name":"Kathy McPhie","company":"Mayfair Ridge Tavern","role":"Delegate","email":"cameron@mcphie.com.au","phone":"0403736113","source":"Liquor Legends VIP","notes":""},{"name":"Carlie Thorman","company":"Nambucca Heads RSL Club","role":"Delegate","email":"wendy.mills@nambuccarsl.com.au","phone":"0407203639","source":"Liquor Legends VIP","notes":""},{"name":"Kelly Smith","company":"Nambucca Heads RSL Club","role":"Delegate","email":"wendy.mills@nambuccarsl.com.au","phone":"0407203639","source":"Liquor Legends VIP","notes":""},{"name":"Clayton Williams","company":"Duporth Tavern","role":"Delegate","email":"CLAYTON@HWHOSP.COM.AU","phone":"0407138565","source":"Liquor Legends VIP","notes":""},{"name":"LEAH WILLIAMS","company":"Duporth Tavern","role":"Delegate","email":"CLAYTON@HWHOSP.COM.AU","phone":"0407138565","source":"Liquor Legends VIP","notes":""},{"name":"Craig Walsh","company":"Colmslie Hotel","role":"Delegate","email":"craig.w@mcguireshotels.com.au","phone":"0404761381","source":"Liquor Legends VIP","notes":""},{"name":"Dana Mitchell","company":"D Aguilar Hotel","role":"Delegate","email":"","phone":"0400123240","source":"Liquor Legends VIP","notes":""},{"name":"Darren Smith","company":"D Aguilar Hotel","role":"Delegate","email":"","phone":"0400123240","source":"Liquor Legends VIP","notes":""},{"name":"David Wilkie","company":"Burpengary Tavern","role":"Delegate","email":"bottleshop@burpengarytav.com.au","phone":"0422208213","source":"Liquor Legends VIP","notes":""},{"name":"Reece Tidyman","company":"Burpengary Tavern","role":"Delegate","email":"bottleshop@burpengarytav.com.au","phone":"0422208213","source":"Liquor Legends VIP","notes":""},{"name":"David Comiskey","company":"Imperial Hotel Eumundi","role":"Delegate","email":"lex2@liquorlegends.com.au","phone":"0411522260","source":"Liquor Legends VIP","notes":""},{"name":"Caitlin Heaven","company":"Imperial Hotel Eumundi","role":"Delegate","email":"lex2@liquorlegends.com.au","phone":"0411522260","source":"Liquor Legends VIP","notes":""},{"name":"David Schultz","company":"Bartletts Tavern","role":"Delegate","email":"retail@athenahg.com.au","phone":"0402457879","source":"Liquor Legends VIP","notes":""},{"name":"Kim Saris","company":"Bartletts Tavern","role":"Delegate","email":"retail@athenahg.com.au","phone":"0402457879","source":"Liquor Legends VIP","notes":""},{"name":"Deana Nasser","company":"Barron Valley Hotel","role":"Delegate","email":"orders@bvhotel.com.au","phone":"0408953511","source":"Liquor Legends VIP","notes":""},{"name":"James Nasser","company":"Barron Valley Hotel","role":"Delegate","email":"orders@bvhotel.com.au","phone":"0408953511","source":"Liquor Legends VIP","notes":""},{"name":"Dominic Mifsud","company":"Brisbane Valley Tavern","role":"Delegate","email":"admin@boonahtavern.com.au","phone":"0497855100","source":"Liquor Legends VIP","notes":""},{"name":"Nic Nykvist","company":"Brisbane Valley Tavern","role":"Delegate","email":"admin@boonahtavern.com.au","phone":"0497855100","source":"Liquor Legends VIP","notes":""},{"name":"Gavin Strack","company":"Robina Pavilion","role":"Delegate","email":"gavinstrack@fhlgroup.com.au","phone":"0438234668","source":"Liquor Legends VIP","notes":""},{"name":"Kate Strack","company":"Robina Pavilion","role":"Delegate","email":"gavinstrack@fhlgroup.com.au","phone":"0438234668","source":"Liquor Legends VIP","notes":""},{"name":"Gregory Casey","company":"Crafty Fox","role":"Delegate","email":"greg@bde.net.au","phone":"0408564126","source":"Liquor Legends VIP","notes":""},{"name":"None","company":"Crafty Fox","role":"Delegate","email":"greg@bde.net.au","phone":"0408564126","source":"Liquor Legends VIP","notes":""},{"name":"Haydn Blair","company":"The Grand Hotel Labrador","role":"Delegate","email":"h.blair@thegrandhotel.com.au","phone":"0407766485","source":"Liquor Legends VIP","notes":""},{"name":"Ian Tregoning","company":"Eagle Tavern","role":"Delegate","email":"itregoning@livingchoice.com.au","phone":"0419007999","source":"Liquor Legends VIP","notes":""},{"name":"Lisa Tregoning","company":"Eagle Tavern","role":"Delegate","email":"itregoning@livingchoice.com.au","phone":"0419007999","source":"Liquor Legends VIP","notes":""},{"name":"James Mitchell","company":"D Aguilar Hotel","role":"Delegate","email":"cricket55@bigpond.com","phone":"0418508419","source":"Liquor Legends VIP","notes":""},{"name":"James Rosato","company":"Beachmere Hotel","role":"Delegate","email":"james@venuplus.com.au","phone":"0459321559","source":"Liquor Legends VIP","notes":""},{"name":"Jesse McKay","company":"Lighthouse Hotel Motel","role":"Delegate","email":"Jayomerta5@gmail.com","phone":"0413273854","source":"Liquor Legends VIP","notes":""},{"name":"Jessica Bartlett","company":"Liquor Legends Mt Tamborine","role":"Delegate","email":"administration@canungrahotel.com.au","phone":"0421500127","source":"Liquor Legends VIP","notes":""},{"name":"Thomas Mahony","company":"Liquor Legends Mt Tamborine","role":"Delegate","email":"administration@canungrahotel.com.au","phone":"0421500127","source":"Liquor Legends VIP","notes":""},{"name":"John Mifsud","company":"Boonah Tavern","role":"Delegate","email":"admin@boonahtavern.com.au","phone":"0427651477","source":"Liquor Legends VIP","notes":""},{"name":"Lynda Mifsud","company":"Boonah Tavern","role":"Delegate","email":"admin@boonahtavern.com.au","phone":"0427651477","source":"Liquor Legends VIP","notes":""},{"name":"Karla Campbell","company":"Liquor Legends Caboolture Bottleshop","role":"Delegate","email":"ct@mpgau.com","phone":"0418885326","source":"Liquor Legends VIP","notes":""},{"name":"Chloe Campbell","company":"Liquor Legends Caboolture Bottleshop","role":"Delegate","email":"ct@mpgau.com","phone":"0418885326","source":"Liquor Legends VIP","notes":""},{"name":"Kelly Jeffs","company":"Beachmere Hotel","role":"Delegate","email":"james@venuplus.com.au","phone":"0459321559","source":"Liquor Legends VIP","notes":""},{"name":"Kylie Williams","company":"Kilcoy Exchange Hotel","role":"Delegate","email":"retail@exchangekilcoy.com.au","phone":"0477800006","source":"Liquor Legends VIP","notes":""},{"name":"April Davis","company":"Kilcoy Exchange Hotel","role":"Delegate","email":"retail@exchangekilcoy.com.au","phone":"0477800006","source":"Liquor Legends VIP","notes":""},{"name":"Laura Durheim","company":"Northern Rivers Hotel","role":"Delegate","email":"laura.durheim@gmail.com","phone":"0434790321","source":"Liquor Legends VIP","notes":""},{"name":"Aidan Weir","company":"Northern Rivers Hotel","role":"Delegate","email":"laura.durheim@gmail.com","phone":"0434790321","source":"Liquor Legends VIP","notes":""},{"name":"Mark Dunbar","company":"Black Nugget Hotel Motel","role":"Delegate","email":"mark@athenahg.com.au","phone":"0409452613","source":"Liquor Legends VIP","notes":""},{"name":"Luana Dunbar","company":"Black Nugget Hotel Motel","role":"Delegate","email":"mark@athenahg.com.au","phone":"0409452613","source":"Liquor Legends VIP","notes":""},{"name":"Mark Smith","company":"Mayfair Ridge Tavern","role":"Delegate","email":"mark@sba.biz","phone":"0413309463","source":"Liquor Legends VIP","notes":""},{"name":"Mark DEmilio","company":"Hervey Bay Hotel","role":"Delegate","email":"markd@herbay.com.au","phone":"0449897622","source":"Liquor Legends VIP","notes":""},{"name":"Breanna Barker","company":"Hervey Bay Hotel","role":"Delegate","email":"markd@herbay.com.au","phone":"0449897622","source":"Liquor Legends VIP","notes":""},{"name":"Mark Knott","company":"Village Green Hotel","role":"Delegate","email":"manager@villagegreenhotel.com.au","phone":"0428399880","source":"Liquor Legends VIP","notes":""},{"name":"KERRY CAHILL","company":"Village Green Hotel","role":"Delegate","email":"manager@villagegreenhotel.com.au","phone":"0428399880","source":"Liquor Legends VIP","notes":""},{"name":"Martin Bell","company":"Liquor Legends Deception Bay Bottleshop","role":"Delegate","email":"dbay@mpgau.com","phone":"0432572017","source":"Liquor Legends VIP","notes":""},{"name":"Meg McPhie","company":"Mayfair Ridge Tavern","role":"Delegate","email":"cameron@mcphie.com.au","phone":"0403736113","source":"Liquor Legends VIP","notes":""},{"name":"Michael Nasser","company":"Barron Valley Hotel","role":"Delegate","email":"orders@bvhotel.com.au","phone":"0472736208","source":"Liquor Legends VIP","notes":""},{"name":"Maree Nasser","company":"Barron Valley Hotel","role":"Delegate","email":"orders@bvhotel.com.au","phone":"0472736208","source":"Liquor Legends VIP","notes":""},{"name":"Paul Comiskey","company":"Imperial Hotel Eumundi","role":"Delegate","email":"lex2@liquorlegends.com.au","phone":"0418732800","source":"Liquor Legends VIP","notes":""},{"name":"Erica Comiskey","company":"Imperial Hotel Eumundi","role":"Delegate","email":"lex2@liquorlegends.com.au","phone":"0418732800","source":"Liquor Legends VIP","notes":""},{"name":"Peter Williams","company":"Maleny Hotel","role":"Delegate","email":"peter@axisiq.com.au","phone":"0404479064","source":"Liquor Legends VIP","notes":""},{"name":"Philip Clinnick","company":"Helensvale Tavern","role":"Delegate","email":"manager@helensvaletavern.com.au","phone":"0433133491","source":"Liquor Legends VIP","notes":""},{"name":"Benjamin Hall","company":"Helensvale Tavern","role":"Delegate","email":"manager@helensvaletavern.com.au","phone":"0433133491","source":"Liquor Legends VIP","notes":""},{"name":"Robert Kingston","company":"1887 Yandina DBS","role":"Delegate","email":"Simon@yandinahotel.com.au","phone":"0416120571","source":"Liquor Legends VIP","notes":""},{"name":"Steph Hollis","company":"1887 Yandina DBS","role":"Delegate","email":"Simon@yandinahotel.com.au","phone":"0416120571","source":"Liquor Legends VIP","notes":""},{"name":"Simon Cross","company":"1887 Yandina Hotel","role":"Delegate","email":"Simon@yandinahotel.com.au","phone":"0497244243","source":"Liquor Legends VIP","notes":""},{"name":"Hayley Cross","company":"1887 Yandina Hotel","role":"Delegate","email":"Simon@yandinahotel.com.au","phone":"0497244243","source":"Liquor Legends VIP","notes":""},{"name":"Simon Walsh","company":"Canungra Hotel","role":"Delegate","email":"simon@canungrahotel.com.au","phone":"0457701855","source":"Liquor Legends VIP","notes":""},{"name":"Angela Graham","company":"Canungra Hotel","role":"Delegate","email":"simon@canungrahotel.com.au","phone":"0457701855","source":"Liquor Legends VIP","notes":""},{"name":"Sophia Bougoure","company":"The Tara Hotel","role":"Delegate","email":"sophie@thetara.com.au","phone":"0474129917","source":"Liquor Legends VIP","notes":""},{"name":"Emma Madden","company":"The Tara Hotel","role":"Delegate","email":"sophie@thetara.com.au","phone":"0474129917","source":"Liquor Legends VIP","notes":""},{"name":"Suzanne Fisalli","company":"Logan City Tavern & Drive Thru","role":"Delegate","email":"suzanne.fisalli@icloud.com","phone":"0419921104","source":"Liquor Legends VIP","notes":""},{"name":"Ashleigh Fisalli","company":"Logan City Tavern & Drive Thru","role":"Delegate","email":"suzanne.fisalli@icloud.com","phone":"0419921104","source":"Liquor Legends VIP","notes":""},{"name":"Terri-Anne Johnston","company":"Robina Pavilion Drive In","role":"Delegate","email":"retail@robinapavilion.com.au","phone":"0438070563","source":"Liquor Legends VIP","notes":""},{"name":"Sue Thompson","company":"Robina Pavilion Drive In","role":"Delegate","email":"retail@robinapavilion.com.au","phone":"0438070563","source":"Liquor Legends VIP","notes":""},{"name":"Timothy Emmerson","company":"Liquor Legends Morayfield","role":"Delegate","email":"moray@mpgau.com","phone":"0434216700","source":"Liquor Legends VIP","notes":""},{"name":"Jodi Michael","company":"Liquor Legends Morayfield","role":"Delegate","email":"moray@mpgau.com","phone":"0434216700","source":"Liquor Legends VIP","notes":""},{"name":"Tom Boorman","company":"Barron Valley Hotel","role":"Delegate","email":"orders@bvhotel.com.au","phone":"0400946911","source":"Liquor Legends VIP","notes":""},{"name":"Vince Fitzgibbons","company":"Logan City Tavern & Drive Thru","role":"Delegate","email":"vince.fitz@hotmail.com","phone":"0421960472","source":"Liquor Legends VIP","notes":""},{"name":"William Griffin","company":"River Road Tavern","role":"Delegate","email":"will.griffin@onefin.net.au","phone":"0410347275","source":"Liquor Legends VIP","notes":""},{"name":"Alexander Sey","company":"River Road Tavern","role":"Delegate","email":"will.griffin@onefin.net.au","phone":"0410347275","source":"Liquor Legends VIP","notes":""},{"name":"William Watson","company":"Maleny Hotel","role":"Delegate","email":"manager@malenyhotel.com.au","phone":"0407062467","source":"Liquor Legends VIP","notes":""},{"name":"Jon","company":"Kawana Dolphins","role":"Rugby League","email":"secretary@kawanarugbyleague.com.au","phone":"0458 640 058","source":"Community Club","notes":""},{"name":"Leigh","company":"Caloundra Sharks","role":"Rugby League","email":"leighdejersey@gmail.com","phone":"0408 700 154","source":"Community Club","notes":""},{"name":"Mike Haines","company":"Brothers","role":"Rugby Union","email":"brothersrugbyclub.sc@gmail.com","phone":"0481 364 888","source":"Community Club","notes":""},{"name":"Mark","company":"USC Barbarians","role":"Rugby Union","email":"president@uscrugby.com.au","phone":"0478 222 879","source":"Community Club","notes":""},{"name":"Craig","company":"Buderim Wanderers","role":"Soccer","email":"CraigL@wanderersfootball.com.au","phone":"0419 998 682","source":"Community Club","notes":""},{"name":"Todd Forest","company":"Kawana","role":"Soccer","email":"todd@amberwerchon.com.au","phone":"0439 112 522","source":"Community Club","notes":""},{"name":"Gez","company":"Willowburn (Toowoomba)","role":"Soccer","email":"president@willowburnfootballclub.com.au","phone":"0424 946 024","source":"Community Club","notes":""},{"name":"Matt Conquest","company":"Pomona Demons","role":"AFL","email":"pomonademons@hotmail.com","phone":"0403 277 651","source":"Community Club","notes":""},{"name":"Michael","company":"Caloundra Panthers","role":"AFL","email":"caloundra.afc@gmail.com","phone":"0418 767 642","source":"Community Club","notes":""},{"name":"Cam Wyatt","company":"Rockhampton Kangaroos","role":"AFL","email":"president@brothersafc.com.au","phone":"0428 297 029","source":"Community Club","notes":""},{"name":"Louise O'Keeffe","company":"Susnhine Coast Lightning","role":"Netball","email":"lokeeffe@sunshinecoastlightning.com.au","phone":"0447 654 129","source":"Community Club","notes":""},{"name":"Darren","company":"Kawana Boardriders","role":"Surfing","email":"kawanaboardriders@gmail.com","phone":"0402 748 923","source":"Community Club","notes":""},{"name":"Luke Wulf","company":"Mudjimba Boardriders","role":"Surfing","email":"treasurer@mudjimbaboardriders.com.au","phone":"0434 626 989","source":"Community Club","notes":""},{"name":"Craig","company":"Mudjimba Longboard Club","role":"Surfing","email":"mudjimbalongboardclub@gmail.com","phone":"0400 684 162","source":"Community Club","notes":""},{"name":"Allan","company":"Mooloolaba Outriggers","role":"Nautical","email":"president@mooloolabaoutriggers.com.au","phone":"0417 734 173","source":"Community Club","notes":""},{"name":"Gary","company":"Mooloolaba Yacht Club","role":"Nautical","email":"mooloolabayachtclub@bigpond.com","phone":"0488 077 011","source":"Community Club","notes":""},{"name":"Adon","company":"Mooloolaba Tennis","role":"Tennis","email":"adon@ktacademy.com.au","phone":"0432 829 110","source":"Community Club","notes":""},{"name":"Trent","company":"Nambour Cutters","role":"Cricket","email":"Treasurer@nambourcc.com","phone":"0407 673 544","source":"Community Club","notes":""},{"name":"Chris","company":"Sunshine Coast Scorchers","role":"Cricket","email":"doc@sunshinecoastcricket.com.au","phone":"0438 108 787","source":"Community Club","notes":""}];

function store() {
  // "strong" consistency so a save is immediately visible to the next read,
  // important since multiple reps may be reading/writing within seconds of
  // each other.
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function readAll(s) {
  const [groupPrices, customerDeals, wholesalerDeals, tempDeals, customerFlags, customerGlassPricing, customerPickFees, customerOffPremisePricing, customerCartonDeliveryFees, rsmTargets, activations, trucks, orders, deliveryRuns, manualOutlets, customerDeliveryDetails, targetCustomers, naDistributions, rsmZoneOverrides, naTargets, customGroups, groupMemberOverrides] = await Promise.all([
    s.get('groupPrices', { type: 'json' }),
    s.get('customerDeals', { type: 'json' }),
    s.get('wholesalerDeals', { type: 'json' }),
    s.get('tempDeals', { type: 'json' }),
    s.get('customerFlags', { type: 'json' }),
    s.get('customerGlassPricing', { type: 'json' }),
    s.get('customerPickFees', { type: 'json' }),
    s.get('customerOffPremisePricing', { type: 'json' }),
    s.get('customerCartonDeliveryFees', { type: 'json' }),
    s.get('rsmTargets', { type: 'json' }),
    s.get('activations', { type: 'json' }),
    s.get('trucks', { type: 'json' }),
    s.get('orders', { type: 'json' }),
    s.get('deliveryRuns', { type: 'json' }),
    s.get('manualOutlets', { type: 'json' }),
    s.get('customerDeliveryDetails', { type: 'json' }),
    s.get('targetCustomers', { type: 'json' }),
    s.get('naDistributions', { type: 'json' }),
    s.get('rsmZoneOverrides', { type: 'json' }),
    s.get('naTargets', { type: 'json' }),
    s.get('customGroups', { type: 'json' }),
    s.get('groupMemberOverrides', { type: 'json' }),
  ]);
  // vipContacts is seeded exactly once — the first time anyone loads the app after this feature
  // ships, the blob won't exist yet (null, not just empty), so we seed it from VIP_CONTACTS_SEED
  // and save it immediately. Every load after that reads the real, saved blob — additions/edits/
  // deletes from the VIP Contacts tab are never overwritten by a future deploy of this function.
  let vipContacts = await s.get('vipContacts', { type: 'json' });
  if (vipContacts === null) {
    const seededAt = new Date().toISOString();
    vipContacts = VIP_CONTACTS_SEED.map((c, i) => ({
      id: 'vip_seed_' + i, ...c, updatedBy: "Feb'26 customer list import", updatedAt: seededAt,
    }));
    await s.setJSON('vipContacts', vipContacts);
  }
  return {
    groupPrices: groupPrices || {},
    customerDeals: customerDeals || {},
    wholesalerDeals: wholesalerDeals || {},
    tempDeals: tempDeals || [],
    customerFlags: customerFlags || {},
    customerGlassPricing: customerGlassPricing || {},
    customerPickFees: customerPickFees || {},
    customerOffPremisePricing: customerOffPremisePricing || {},
    customerCartonDeliveryFees: customerCartonDeliveryFees || {},
    rsmTargets: rsmTargets || {},
    activations: activations || [],
    trucks: trucks || [],
    orders: orders || [],
    deliveryRuns: deliveryRuns || [],
    manualOutlets: manualOutlets || {},
    customerDeliveryDetails: customerDeliveryDetails || {},
    targetCustomers: targetCustomers || [],
    naDistributions: naDistributions || {},
    vipContacts,
    rsmZoneOverrides: rsmZoneOverrides || {},
    naTargets: naTargets || {},
    customGroups: customGroups || [],
    groupMemberOverrides: groupMemberOverrides || {},
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return json({ ok: true });
  }

  const s = store();

  if (req.method === 'GET') {
    return json(await readAll(s));
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action, payload } = body || {};
  if (!action) return json({ error: 'Missing action' }, 400);
  const now = new Date().toISOString();

  try {
    if (action === 'saveGroupPrice') {
      const { groupId, listPrice, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, listPrice, updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'setGroupEnabled') {
      const { groupId, enabled, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, enabled: !!enabled, updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'saveCustomerDeal') {
      const { outletId, groupId, dealX, updatedBy } = payload;
      const current = (await s.get('customerDeals', { type: 'json' })) || {};
      const key = outletId + '|' + groupId;
      if (Number(dealX) === 0) {
        delete current[key];
      } else {
        current[key] = { dealX: Number(dealX), updatedBy, updatedAt: now };
      }
      await s.setJSON('customerDeals', current);
      return json({ ok: true, customerDeals: current });
    }

    if (action === 'bulkApplyDeal') {
      const { outletId, groupIds, dealX, updatedBy } = payload;
      const current = (await s.get('customerDeals', { type: 'json' })) || {};
      (groupIds || []).forEach((groupId) => {
        const key = outletId + '|' + groupId;
        if (Number(dealX) === 0) delete current[key];
        else current[key] = { dealX: Number(dealX), updatedBy, updatedAt: now };
      });
      await s.setJSON('customerDeals', current);
      return json({ ok: true, customerDeals: current });
    }

    if (action === 'saveWholesalerDeal') {
      // A second, separate deal record for stock loaded into a wholesaler (ALM/ILG/PAR) rather
      // than bought direct — kept in its own blob key so it never collides/merges with customerDeals.
      const { outletId, groupId, dealX, wholesaler, updatedBy } = payload;
      const current = (await s.get('wholesalerDeals', { type: 'json' })) || {};
      const key = outletId + '|' + groupId;
      if (Number(dealX) === 0) {
        delete current[key];
      } else {
        current[key] = { dealX: Number(dealX), wholesaler: wholesaler || null, updatedBy, updatedAt: now };
      }
      await s.setJSON('wholesalerDeals', current);
      return json({ ok: true, wholesalerDeals: current });
    }

    if (action === 'bulkApplyWholesalerDeal') {
      const { outletId, groupIds, dealX, wholesaler, updatedBy } = payload;
      const current = (await s.get('wholesalerDeals', { type: 'json' })) || {};
      (groupIds || []).forEach((groupId) => {
        const key = outletId + '|' + groupId;
        if (Number(dealX) === 0) delete current[key];
        else current[key] = { dealX: Number(dealX), wholesaler: wholesaler || null, updatedBy, updatedAt: now };
      });
      await s.setJSON('wholesalerDeals', current);
      return json({ ok: true, wholesalerDeals: current });
    }

    if (action === 'saveNaDistribution') {
      // Manually-entered, quarterly store-distribution counts for Coles/Woolworths (Coles &
      // Woolworths tab) — we don't get real per-store listing data for these bulk/national
      // accounts the way we do for Sales Team accounts, so this is entered by hand and used to
      // compute units-per-store-per-week against real carton sales volume.
      const { quarterKey, ownerGroup, groupId, count, updatedBy } = payload;
      const current = (await s.get('naDistributions', { type: 'json' })) || {};
      const key = quarterKey + '|' + ownerGroup + '|' + groupId;
      const num = Math.max(0, Math.round(Number(count) || 0));
      if (num === 0) {
        delete current[key];
      } else {
        current[key] = { count: num, updatedBy, updatedAt: now };
      }
      await s.setJSON('naDistributions', current);
      return json({ ok: true, naDistributions: current });
    }

    if (action === 'saveTempDeal') {
      const { id, outletId, groupId, dealX, start, end, notes, updatedBy } = payload;
      const current = (await s.get('tempDeals', { type: 'json' })) || [];
      const newId = id || ('td_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((t) => t.id === newId);
      const rec = { id: newId, outletId, groupId, dealX: Number(dealX), start, end, notes: notes || '', updatedBy, updatedAt: now };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('tempDeals', current);
      return json({ ok: true, id: newId, tempDeals: current });
    }

    if (action === 'deleteTempDeal') {
      const { id } = payload;
      const current = (await s.get('tempDeals', { type: 'json' })) || [];
      const next = current.filter((t) => t.id !== id);
      await s.setJSON('tempDeals', next);
      return json({ ok: true, tempDeals: next });
    }

    if (action === 'saveCustomerFlag') {
      // field is 'pricingUpdated', 'metWithCustomer' (booleans), or 'notes' (string)
      const { outletId, field, value, updatedBy } = payload;
      const current = (await s.get('customerFlags', { type: 'json' })) || {};
      const existing = current[outletId] || { pricingUpdated: false, metWithCustomer: false };
      current[outletId] = { ...existing, [field]: value, updatedBy, updatedAt: now };
      await s.setJSON('customerFlags', current);
      return json({ ok: true, customerFlags: current });
    }

    if (action === 'saveGlassSize') {
      // Glass sizes are shared across every beer for a customer.
      const { outletId, glassKey, sizeMl, updatedBy } = payload;
      const current = (await s.get('customerGlassPricing', { type: 'json' })) || {};
      const existingOutlet = current[outletId] || {};
      const sizes = { ...(existingOutlet.sizes || {}), [glassKey]: Number(sizeMl) };
      current[outletId] = { ...existingOutlet, sizes, updatedBy, updatedAt: now };
      await s.setJSON('customerGlassPricing', current);
      return json({ ok: true, customerGlassPricing: current });
    }

    if (action === 'saveGlassPrice') {
      // Glass retail prices (inc GST) are set per SKU (groupId).
      const { outletId, groupId, glassKey, price, updatedBy } = payload;
      const current = (await s.get('customerGlassPricing', { type: 'json' })) || {};
      const existingOutlet = current[outletId] || {};
      const prices = { ...(existingOutlet.prices || {}) };
      prices[groupId] = { ...(prices[groupId] || {}), [glassKey]: Number(price) };
      current[outletId] = { ...existingOutlet, prices, updatedBy, updatedAt: now };
      await s.setJSON('customerGlassPricing', current);
      return json({ ok: true, customerGlassPricing: current });
    }

    if (action === 'savePickFee') {
      // Optional, shared between the Venues and Off Premise calculators. unitType is 'keg' or
      // 'carton'; fee may be null to clear it back to "not set" (blank).
      const { outletId, unitType, fee, updatedBy } = payload;
      const current = (await s.get('customerPickFees', { type: 'json' })) || {};
      const existing = current[outletId] || {};
      current[outletId] = { ...existing, [unitType]: (fee === null || fee === undefined) ? null : Number(fee), updatedBy, updatedAt: now };
      await s.setJSON('customerPickFees', current);
      return json({ ok: true, customerPickFees: current });
    }

    if (action === 'saveCartonDeliveryFee') {
      // Optional, used only by the Off Premise calculator's Wholesaler vs Direct comparison.
      // scenario is 'wholesaler' or 'direct'; fee may be null to clear it back to "not set" (blank).
      const { outletId, scenario, fee, updatedBy } = payload;
      const current = (await s.get('customerCartonDeliveryFees', { type: 'json' })) || {};
      const existing = current[outletId] || {};
      current[outletId] = { ...existing, [scenario]: (fee === null || fee === undefined) ? null : Number(fee), updatedBy, updatedAt: now };
      await s.setJSON('customerCartonDeliveryFees', current);
      return json({ ok: true, customerCartonDeliveryFees: current });
    }

    if (action === 'saveCartonPackQty') {
      // Cans per carton — set per SKU group on the Product List Prices page, since each SKU
      // can genuinely come in a different carton size. Used by both margin calculators.
      const { groupId, cartonPackQty, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, cartonPackQty: Number(cartonPackQty), updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'saveMultipackQty') {
      // Cans per multipack — set per SKU group (not per customer), since different beers can
      // come in different multipack sizes (e.g. a 4-pack vs a 6-pack).
      const { groupId, multipackQty, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, multipackQty: Number(multipackQty), updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'saveCanSizeMl') {
      // mL per can — set per SKU group, for display/reference alongside carton math.
      const { groupId, canSizeMl, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, canSizeMl: Number(canSizeMl), updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'saveOffPremisePrice') {
      // Carton/multipack/single retail prices (inc GST) are set per SKU (groupId). The
      // 'single' price is also shown on the Venues calculator for the same customer/SKU.
      const { outletId, groupId, priceType, price, updatedBy } = payload;
      const current = (await s.get('customerOffPremisePricing', { type: 'json' })) || {};
      const existingOutlet = current[outletId] || {};
      const prices = { ...(existingOutlet.prices || {}) };
      prices[groupId] = { ...(prices[groupId] || {}), [priceType]: Number(price) };
      current[outletId] = { ...existingOutlet, prices, updatedBy, updatedAt: now };
      await s.setJSON('customerOffPremisePricing', current);
      return json({ ok: true, customerOffPremisePricing: current });
    }

    if (action === 'saveRsmTarget') {
      // field is one of: totalVolumeTarget, kegVolumeTarget, cartonVolumeTarget,
      // kegListingsTarget, cartonListingsTarget. value may be null to clear it (back to blank).
      const { rsm, quarterKey, field, value, updatedBy } = payload;
      const current = (await s.get('rsmTargets', { type: 'json' })) || {};
      const key = rsm + '|' + quarterKey;
      const existing = current[key] || {};
      if (value === null || value === undefined) {
        const updated = { ...existing };
        delete updated[field];
        current[key] = { ...updated, updatedBy, updatedAt: now };
      } else {
        current[key] = { ...existing, [field]: Number(value), updatedBy, updatedAt: now };
      }
      await s.setJSON('rsmTargets', current);
      return json({ ok: true, rsmTargets: current });
    }

    if (action === 'saveActivation') {
      const { id, outletId, productType, activationType, start, end, dealX, bonusStock, pos, consumerPricing, groupId, tempDealId, updatedBy } = payload;
      const current = (await s.get('activations', { type: 'json' })) || [];
      const newId = id || ('act_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((a) => a.id === newId);
      const rec = {
        id: newId, outletId, productType, activationType, start, end,
        dealX: Number(dealX) || 0, bonusStock: bonusStock || '', pos: pos || '', consumerPricing: consumerPricing || '',
        groupId: groupId || null, tempDealId: tempDealId || null,
        updatedBy, updatedAt: now,
      };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('activations', current);
      return json({ ok: true, id: newId, activations: current });
    }

    if (action === 'deleteActivation') {
      const { id } = payload;
      const current = (await s.get('activations', { type: 'json' })) || [];
      const next = current.filter((a) => a.id !== id);
      await s.setJSON('activations', next);
      return json({ ok: true, activations: next });
    }

    if (action === 'saveTargetCustomer') {
      // The quarterly "who are we going after" list for kegs/cartons. Guard against a duplicate
      // add server-side too (not just client-side), in case two reps race to add the same
      // customer within the same quarter/bucket. "Onboarded" status is NOT stored — it's computed
      // live on the client from sales data (active in the current purchase cycle), so there's
      // nothing to persist here beyond who nominated the target and when.
      const { outletId, rsm, quarterKey, bucket, updatedBy } = payload;
      const current = (await s.get('targetCustomers', { type: 'json' })) || [];
      const dup = current.find((t) => t.outletId === outletId && t.quarterKey === quarterKey && t.bucket === bucket);
      if (dup) return json({ ok: true, id: dup.id, targetCustomers: current });
      const newId = 'tc_' + Date.now() + '_' + Math.round(Math.random() * 10000);
      current.push({
        id: newId, rsm, quarterKey, bucket, outletId,
        addedBy: updatedBy, addedAt: now,
      });
      await s.setJSON('targetCustomers', current);
      return json({ ok: true, id: newId, targetCustomers: current });
    }

    if (action === 'deleteTargetCustomer') {
      const { id } = payload;
      const current = (await s.get('targetCustomers', { type: 'json' })) || [];
      const next = current.filter((t) => t.id !== id);
      await s.setJSON('targetCustomers', next);
      return json({ ok: true, targetCustomers: next });
    }

    if (action === 'saveWeightKg') {
      // Weight per sale unit (per keg, or per carton) — used by the Orders/Delivery tools to
      // work out a load's total weight and check it against a truck's capacity.
      const { groupId, weightKg, updatedBy } = payload;
      const current = (await s.get('groupPrices', { type: 'json' })) || {};
      const existing = current[groupId] || {};
      current[groupId] = { ...existing, weightKg: Number(weightKg), updatedBy, updatedAt: now };
      await s.setJSON('groupPrices', current);
      return json({ ok: true, groupPrices: current });
    }

    if (action === 'addCustomGroup') {
      // Adds a brand-new, self-serve SKU group (either a fresh custom product or a group
      // split off from an existing multi-member group). Upserted by id so re-saving an
      // edited custom group (e.g. re-running a split) just replaces the prior record.
      const { group } = payload;
      const current = (await s.get('customGroups', { type: 'json' })) || [];
      const idx = current.findIndex((g) => g.id === group.id);
      if (idx >= 0) current[idx] = group; else current.push(group);
      await s.setJSON('customGroups', current);
      return json({ ok: true, customGroups: current });
    }

    if (action === 'splitGroupMembers') {
      // Splits one or more member SKUs off an existing group into a brand-new group.
      // remainingMembers trims the ORIGINAL group's member list (stored as an override,
      // since the original group itself is baked reference data, not editable in place);
      // newGroup is the freshly created group holding the split-off members.
      const { originalGroupId, remainingMembers, newGroup } = payload;
      const currentGroups = (await s.get('customGroups', { type: 'json' })) || [];
      const idx = currentGroups.findIndex((g) => g.id === newGroup.id);
      if (idx >= 0) currentGroups[idx] = newGroup; else currentGroups.push(newGroup);
      await s.setJSON('customGroups', currentGroups);
      const currentOverrides = (await s.get('groupMemberOverrides', { type: 'json' })) || {};
      currentOverrides[originalGroupId] = remainingMembers;
      await s.setJSON('groupMemberOverrides', currentOverrides);
      return json({ ok: true, customGroups: currentGroups, groupMemberOverrides: currentOverrides });
    }

    if (action === 'saveTruck') {
      const { id, name, maxWeightKg, updatedBy } = payload;
      const current = (await s.get('trucks', { type: 'json' })) || [];
      const newId = id || ('truck_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((t) => t.id === newId);
      const rec = { id: newId, name, maxWeightKg: Number(maxWeightKg), updatedBy, updatedAt: now };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('trucks', current);
      return json({ ok: true, id: newId, trucks: current });
    }

    if (action === 'deleteTruck') {
      const { id } = payload;
      const current = (await s.get('trucks', { type: 'json' })) || [];
      const next = current.filter((t) => t.id !== id);
      await s.setJSON('trucks', next);
      return json({ ok: true, trucks: next });
    }

    if (action === 'saveOrder') {
      // The whole order record (lines[], delivery{}, etc.) is sent as one object — simpler and
      // less error-prone than flattening a deeply nested shape into individual args. The server
      // just assigns an id if it's new and upserts by id, same pattern as everywhere else.
      const { order } = payload;
      const current = (await s.get('orders', { type: 'json' })) || [];
      const newId = order.id || ('ord_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((o) => o.id === newId);
      const rec = { ...order, id: newId, updatedAt: now };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('orders', current);
      return json({ ok: true, id: newId, orders: current });
    }

    if (action === 'deleteOrder') {
      const { id } = payload;
      const current = (await s.get('orders', { type: 'json' })) || [];
      const next = current.filter((o) => o.id !== id);
      await s.setJSON('orders', next);
      return json({ ok: true, orders: next });
    }

    if (action === 'saveRun') {
      // Same whole-object upsert pattern as saveOrder.
      const { run } = payload;
      const current = (await s.get('deliveryRuns', { type: 'json' })) || [];
      const newId = run.id || ('run_' + Date.now() + '_' + Math.round(Math.random() * 10000));
      const idx = current.findIndex((r) => r.id === newId);
      const rec = { ...run, id: newId, updatedAt: now };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('deliveryRuns', current);
      return json({ ok: true, id: newId, deliveryRuns: current });
    }

    if (action === 'deleteRun') {
      const { id } = payload;
      const current = (await s.get('deliveryRuns', { type: 'json' })) || [];
      const next = current.filter((r) => r.id !== id);
      await s.setJSON('deliveryRuns', next);
      return json({ ok: true, deliveryRuns: next });
    }

    if (action === 'saveManualOutlet') {
      // Customers added before they have any sales history — keyed by outlet ID (either a real
      // ID the rep already knows, e.g. from a licensing/POS system, or an auto-generated
      // placeholder from the client if not). Dictionary-keyed like groupPrices/customerFlags,
      // since the id IS the key — no separate "assign a new id" step needed like orders/runs.
      const { outlet } = payload;
      const current = (await s.get('manualOutlets', { type: 'json' })) || {};
      current[outlet.id] = { ...outlet, updatedAt: now };
      await s.setJSON('manualOutlets', current);
      return json({ ok: true, id: outlet.id, manualOutlets: current });
    }

    if (action === 'deleteManualOutlet') {
      const { id } = payload;
      const current = (await s.get('manualOutlets', { type: 'json' })) || {};
      delete current[id];
      await s.setJSON('manualOutlets', current);
      return json({ ok: true, manualOutlets: current });
    }

    if (action === 'saveDeliveryDetails') {
      // Access notes/on-site contact/preferred timing per customer — dictionary-keyed by outlet
      // ID like customerFlags/manualOutlets. Saved as one whole record per "Save" click (not
      // per-field), matching the batch-save UX on the Customer Summary page. Merges onto any
      // existing record (rather than replacing it outright) so this never clobbers email/email2/
      // familyGroup saved separately via 'saveContactInfo' below — same record, two save buttons.
      const { outletId, accessNotes, contactName, contactPhone, preferredDay, preferredWindow, updatedBy } = payload;
      const current = (await s.get('customerDeliveryDetails', { type: 'json' })) || {};
      const rec = { ...(current[outletId] || {}), accessNotes, contactName, contactPhone, preferredDay, preferredWindow, updatedBy, updatedAt: now };
      const isBlank = !rec.accessNotes && !rec.contactName && !rec.contactPhone && !rec.preferredWindow
        && (!rec.preferredDay || rec.preferredDay === 'Any day') && !rec.email && !rec.email2 && !rec.familyGroup;
      if (isBlank) delete current[outletId]; else current[outletId] = rec;
      await s.setJSON('customerDeliveryDetails', current);
      return json({ ok: true, customerDeliveryDetails: current });
    }

    if (action === 'saveContactInfo') {
      // Email(s) + family/franchise group per customer — shares the same customerDeliveryDetails
      // record as 'saveDeliveryDetails' above (one record per outlet), merging in rather than
      // replacing so the two "Save" buttons on Customer Summary never stomp on each other.
      const { outletId, email, email2, familyGroup, updatedBy } = payload;
      const current = (await s.get('customerDeliveryDetails', { type: 'json' })) || {};
      const rec = { ...(current[outletId] || {}), email, email2, familyGroup, updatedBy, updatedAt: now };
      const isBlank = !rec.accessNotes && !rec.contactName && !rec.contactPhone && !rec.preferredWindow
        && (!rec.preferredDay || rec.preferredDay === 'Any day') && !rec.email && !rec.email2 && !rec.familyGroup;
      if (isBlank) delete current[outletId]; else current[outletId] = rec;
      await s.setJSON('customerDeliveryDetails', current);
      return json({ ok: true, customerDeliveryDetails: current });
    }

    if (action === 'saveVipContact') {
      // Industry contacts who aren't purchasing outlets themselves — a plain array with a
      // client-generated id, upserted by id (same shape/pattern as 'saveActivation' above).
      const { contact } = payload;
      const current = (await s.get('vipContacts', { type: 'json' })) || [];
      const idx = current.findIndex((c) => c.id === contact.id);
      const rec = { ...contact, updatedAt: now };
      if (idx >= 0) current[idx] = rec; else current.push(rec);
      await s.setJSON('vipContacts', current);
      return json({ ok: true, vipContacts: current });
    }

    if (action === 'deleteVipContact') {
      const { id } = payload;
      const current = (await s.get('vipContacts', { type: 'json' })) || [];
      const next = current.filter((c) => c.id !== id);
      await s.setJSON('vipContacts', next);
      return json({ ok: true, vipContacts: next });
    }

    if (action === 'saveRsmZoneOverride') {
      // Lets the user immediately reassign which RSM a zone belongs to, ahead of the periodic
      // Ontap-driven data pipeline refresh — { [zone]: rsmName }, keyed by zone. Saving an empty/
      // blank rsm value clears the override for that zone (reverting it to whatever Ontap has on
      // file, once the app applies this against the baked outlet data — see applyRsmZoneOverrides()
      // in netlify_part1.js).
      const { zone, rsm } = payload;
      const current = (await s.get('rsmZoneOverrides', { type: 'json' })) || {};
      const clean = (rsm || '').trim();
      if (clean) current[zone] = clean; else delete current[zone];
      await s.setJSON('rsmZoneOverrides', current);
      return json({ ok: true, rsmZoneOverrides: current });
    }

    if (action === 'saveNaTarget') {
      // National Accounts (Coles & Woolworths) volume target, per FY quarter — sits outside the
      // RSM-based rsmTargets collection, used by the Total Volume page to build a combined
      // company-wide target line. value may be null to clear it (back to blank).
      const { quarterKey, cartonVolumeTarget, updatedBy } = payload;
      const current = (await s.get('naTargets', { type: 'json' })) || {};
      const existing = current[quarterKey] || {};
      if (cartonVolumeTarget === null || cartonVolumeTarget === undefined) {
        const updated = { ...existing };
        delete updated.cartonVolumeTarget;
        current[quarterKey] = { ...updated, updatedBy, updatedAt: now };
      } else {
        current[quarterKey] = { ...existing, cartonVolumeTarget: Number(cartonVolumeTarget), updatedBy, updatedAt: now };
      }
      await s.setJSON('naTargets', current);
      return json({ ok: true, naTargets: current });
    }

    return json({ error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
};
